import {calendar_v3, google} from 'googleapis';
import {GoogleSpreadsheet, GoogleSpreadsheetRow} from 'google-spreadsheet';
import {config} from 'dotenv';
import {format, isWithinInterval, parse, add, sub} from 'date-fns';
import debug from 'debug'
import * as fs from "fs";

const d = debug('events-to-spreadsheet:')

// 11/24/2022 20:35:00
const secondsInADay = 86400;
const formatString = "yyyy/MM/dd H:mm:ss";

let newReplayMap: Record<string, any> = {};
const replayMapPath = './replay.json';
const isReplaying = process.env.REPLAY === 'true';
const replayableFunction = <T>(key: string, f: () => Promise<T>): () => Promise<T> => async () => {
    if (isReplaying) {
        const lastReplayMap = JSON.parse(fs.readFileSync(replayMapPath).toString('utf8'));
        if (lastReplayMap[key] === undefined) {
            throw new Error(`Replay dictionary key ${key} is undefined`);
        }
        return lastReplayMap[key];
    }

    const returned = await f();
    if (newReplayMap[key]) {
        // THere' sa possibility of adding array replaying, but it gets way too complicated
        throw new Error(`replayKey: ${key} used twice.  You cannot use the same key in different places, or call the same function twice`)
    }
    newReplayMap[key] = returned;
    return newReplayMap[key];
}
const startReplay = () => {
    newReplayMap = {};
}
const endReplay = () => {
    if (!isReplaying) {
        fs.writeFileSync(replayMapPath, JSON.stringify(newReplayMap, undefined,'\t'));
    }
}

const parseSpreadsheetDate = (dateStr: string) => parse(dateStr, formatString, new Date());

config()

const jsonCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS as string);
const fromJsonCredentials = google.auth.fromJSON(jsonCredentials);
// @ts-ignore
fromJsonCredentials.scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events"
];

type CalendarSheetConfig = {
    sheetTitle: string;
    calendarId: string;
}

const calendarSheetConfigs = JSON.parse(process.env.CALENDAR_SHEET_CONFIGURATIONS as string) as CalendarSheetConfig[];
const docId = process.env.SHEET_ID as string;


const timeOffsetStart = parseInt(process.env.TIME_OFFSET_START || String(secondsInADay * 31));
const timeOffsetEnd = parseInt(process.env.TIME_OFFSET_END || String(secondsInADay * 31));

const runInterval = parseInt(process.env.RUN_INTERVAL || "60000");

type SpreadsheetRowType = {
    Start: string,
    Student: string
};

const isSpreadsheetStartDateWithinDateRage = (date: Date) => {
    // The date filter in google calendar is a bit looser somehow, and events not strictly between the ranges even will appear
    // So when filtering spreadsheet rows, keep some which aren't strictly in our date range
    const minDate = sub(getMinDate(), {days: 2});
    const maxDate = add(getMaxDate(), {days: 2});
    return isWithinInterval(date, {
        start: minDate,
        end: maxDate
    })
}

class SpreadsheetRowHelper {
    constructor(public r: SpreadsheetRowType) {
    }

    isWithinDateRange() {
        return isSpreadsheetStartDateWithinDateRage(this.Start())
    }

    Student(): string {
        return this.r.Student;
    }

    Start(): Date {
        return parseSpreadsheetDate(this.r.Start);
    }
}

const removeTimezoneFromGoogleDate = (dateString: string) => {
    return dateString.replace(/[+-]\d{2}:\d{2}$/, '');
}

const isSame = (spreadsheetRecord: SpreadsheetRowHelper, event: calendar_v3.Schema$Event) => {
    const student = spreadsheetRecord.Student();
    const summary = event.summary;
    const toISOString = spreadsheetRecord.Start().toISOString();
    const date = new Date(removeTimezoneFromGoogleDate(event.start?.dateTime as string));
    const start = date.toISOString();
    return student === summary &&
        toISOString === start;
};

const getMinDate = () => new Date((new Date().getTime() - (timeOffsetStart * 1000)));

const getMaxDate = () => new Date((new Date().getTime() + (timeOffsetEnd * 1000)));

(async () => {
    const runIteration = async () => {
        startReplay();
        const calendar = google.calendar({version: 'v3', auth: fromJsonCredentials});
        const doc = new GoogleSpreadsheet(docId);
        d(`Authenticating document`)
        await doc.useServiceAccountAuth(jsonCredentials);
        await doc.loadInfo();
        for (let i = 0; i < calendarSheetConfigs.length; i++) {
            const {calendarId, sheetTitle} = calendarSheetConfigs[i];
/*
Commenting this out because I don't know if this call is indepontent, but when there's a new calendar I gotta run it aagin
            try {
                const v = await calendar.calendarList.insert({requestBody: {id: calendarId, accessRole: 'reader'}})
                console.log(v.data);
            } catch(e){
                console.error();
            }
*/
            const sheet = doc.sheetsByTitle[sheetTitle];
            d(`Adding events for ${calendarId} ${sheetTitle}`)
            // Only take the records and events from within a month, so we don't have too many things
            const fetchAllCalendarEvents = replayableFunction(`calendarEvents-${calendarId}-${sheetTitle}`, async () => {
                const timeMin = getMinDate().toISOString();
                const timeMax = getMaxDate().toISOString();
                const response = await calendar.events.list({
                        calendarId,
                        timeMin: timeMin,
                        timeMax: timeMax,
                        singleEvents: true,
                        orderBy: 'startTime',
                        maxResults: 2500
                    },
                    {}
                )

                if (!response.data.items) {
                    d(`Something went wrong fetching events from calendar ${calendarId}`);
                }

                d(`Fetched ${response.data.items?.length} events from calendar`);

                // Filter out items with no summary, we can ignore those
                return response.data.items?.filter(item => item.summary) || [];
            })
            const fetchAllSpreadsheetRecords = replayableFunction(`spreadsheetRecords-${calendarId}-${sheetTitle}`, async () => {
                d(`Getting rows from sheet...`)
                // @ts-ignore
                return (await sheet.getRows()).map((r: SpreadsheetRowType) => ({Student: r.Student, Start: r.Start}));
            })
            const filterSpreadsheetRows = (rawRows: SpreadsheetRowType[]) => {
                const rows: SpreadsheetRowHelper[] = rawRows.map(row => new SpreadsheetRowHelper(row))
                d(`fetched ${rows.length} rows from sheet.  Filtering rows...`)
                const filteredRows = rows.filter(row => row.isWithinDateRange());
                d(`${filteredRows.length} rows left after filter`)
                return filteredRows;
            }

            const compareEventsAndSpreadsheet = async () => {
                const allEvents = await fetchAllCalendarEvents();
                const allSpreadsheetRecords = filterSpreadsheetRows(await fetchAllSpreadsheetRecords());
                const eventsWhichDontExistInTheSpreadsheet = allEvents
                    .filter(
                        event => {
                            let b = !allSpreadsheetRecords
                                .find(
                                    spreadsheetRecord => {
                                        return isSame(spreadsheetRecord, event);
                                    }
                                );
                            return b;
                        }
                    );

                const insertRecordsIntoSpreadsheet = async () => {
                    if (!eventsWhichDontExistInTheSpreadsheet.length) {
                        d(`No events to insert into spreadsheet`);
                        return;
                    }
                    d(`Adding ${eventsWhichDontExistInTheSpreadsheet.length} rows to spreadsheet...`);
                    const fmtDate = (d: undefined | null | string) => {
                        const removeTimezoneFromGoogleDate1 = d && removeTimezoneFromGoogleDate(d);
                        const date = removeTimezoneFromGoogleDate1 && new Date(removeTimezoneFromGoogleDate1);
                        return date ?
                            format(date, formatString) :
                            date
                    }
                    const rowsBeingAdded = eventsWhichDontExistInTheSpreadsheet.map(evElement => {
                            return (
                                {
                                    Student: evElement.summary as string,
                                    Start: fmtDate(evElement.start?.dateTime) || "No start date",
                                    End: fmtDate(evElement.end?.dateTime) || "No end date",
                                }
                            );
                        }
                    );
                    const result = await sheet.addRows(
                        rowsBeingAdded
                    );
                    d(`Added ${result.length} rows to spreadsheet.`);
                    d(JSON.stringify(rowsBeingAdded))
                }
                await insertRecordsIntoSpreadsheet()
            }
            await compareEventsAndSpreadsheet();
            endReplay();
        }

    }
    if (process.env.SERVICE_PAUSED === 'true') {
        console.log(`service paused, exiting`)
        return;
    }
    while (true) {
        try {
            d(`running iteration...`)
            await runIteration();
        } catch (e) {
            console.error(e)
        }
        d(`Finished iteration.  Waiting ${runInterval}ms`)
        await new Promise(resolve => setTimeout(resolve, runInterval))
    }
})();

