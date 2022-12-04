import {calendar_v3, google} from 'googleapis';
import {GoogleSpreadsheet, GoogleSpreadsheetRow} from 'google-spreadsheet';
import {config} from 'dotenv';
import {format, isWithinInterval, parse} from 'date-fns';
import debug from 'debug'
import * as fs from "fs";

const d = debug('events-to-spreadsheet:')

// 11/24/2022 20:35:00
const secondsInADay = 86400;
const formatString = "yyyy/MM/dd H:mm:ss";


/**
 * Start replayable function
 */
let newReplayMap: Record<string, any> = {};
const replayMapPath = './replay.json';
const replayableFunction = <T>(key: string, f: () => Promise<T>): () => Promise<T> => async () => {
    const isReplaying = process.env.REPLAY === 'true';
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
    fs.writeFileSync(replayMapPath, JSON.stringify(newReplayMap, undefined,'\t'));
}
/**
 * End replayable function function
 * @param dateStr
 */

const parseSpreadsheetDate = (dateStr: string) => parse(dateStr, formatString, new Date());

config()

const jsonCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS as string);
const fromJsonCredentials = google.auth.fromJSON(jsonCredentials);
// @ts-ignore
fromJsonCredentials.scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events"
];
const calendarId = process.env.CALENDAR_ID as string;
const sheetId = process.env.SHEET_ID as string;


const timeOffsetStart = parseInt(process.env.TIME_OFFSET_START || String(secondsInADay * 31));
const timeOffsetEnd = parseInt(process.env.TIME_OFFSET_END || String(secondsInADay * 31));

const runInterval = parseInt(process.env.RUN_INTERVAL || "60000");

type SpreadsheetRowType = {
    Start: string,
    Student: string
};

const isWithinDateRange = (date: Date) => {
    return isWithinInterval(date, {
        start: new Date(((new Date().getTime() / 1000) - timeOffsetStart) * 1000),
        end: new Date(((new Date().getTime() / 1000) + timeOffsetEnd) * 1000)
    })
}

class SpreadsheetRowHelper {
    constructor(public r: SpreadsheetRowType) {
    }

    isWithinDateRange() {
        return isWithinDateRange(this.Start())
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
    if (spreadsheetRecord.r.Student === undefined && spreadsheetRecord.r.Start === "2022/12/04 18:00:00") {
        debugger;console.log();
    }
    if (spreadsheetRecord.r.Student === 'Marvin' && spreadsheetRecord.r.Start === "2022/12/05 9:00:00") {
        debugger;console.log();
    }
    const student = spreadsheetRecord.Student();
    const summary = event.summary;
    const toISOString = spreadsheetRecord.Start().toISOString();
    const date = new Date(removeTimezoneFromGoogleDate(event.start?.dateTime as string));
    const start = date.toISOString();
    return student === summary &&
        toISOString === start;
};

(async () => {
    const runIteration = async () => {
        startReplay();
        const calendar = google.calendar({version: 'v3', auth: fromJsonCredentials});
        const doc = new GoogleSpreadsheet(sheetId);
        d(`Authenticating document`)
        await doc.useServiceAccountAuth(jsonCredentials);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        d(`Resolved sheet`)
        // Only take the records and events from within a month, so we don't have too many things
        const fetchAllCalendarEvents = replayableFunction("calendarEvents", async () => {
            const response = await calendar.events.list({
                    calendarId,
                    timeMin: new Date((new Date().getTime() - (timeOffsetStart * 1000))).toISOString(),
                    timeMax: new Date((new Date().getTime() + (timeOffsetEnd * 1000))).toISOString(),
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
        const fetchAllSpreadsheetRecords = replayableFunction('spreadsheetRecords', async () => {
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

/*
Don't delete anything because we only add calendar schedules from today and not in the future
            const spreadsheetRecordsWhichDontExistInTheCalendar = allSpreadsheetRecords
                // First filter the records which are actually student attendance records
                .filter(spreadsheetRecord => spreadsheetRecord.Student())
                // Now filter records which dont exist as events
                .filter(spreadsheetRecord => {
                    const existsInCalendar = allEvents.find(event => {
                        return isSame(spreadsheetRecord, event)
                    })
                    return !existsInCalendar;
                });
            // Now delete these
            for (let i = 0; i < spreadsheetRecordsWhichDontExistInTheCalendar.length; i++) {
                const spreadsheetRecordsWhichDontExistInTheCalendarElement = spreadsheetRecordsWhichDontExistInTheCalendar[i];
                console.log(`delete ${spreadsheetRecordsWhichDontExistInTheCalendarElement.Student()} ${spreadsheetRecordsWhichDontExistInTheCalendarElement.Start()}`)
            }
*/

            const insertRecordsIntoSpreadsheet = async () => {
                if (!eventsWhichDontExistInTheSpreadsheet.length) {
                    d(`No events to insert into spreadsheet`);
                    return;
                }
                d(`Adding ${eventsWhichDontExistInTheSpreadsheet.length} rows to spreadsheet...`);
                const fmtDate = (d: undefined | null | string) => {
                    let removeTimezoneFromGoogleDate1 = d && removeTimezoneFromGoogleDate(d);
                    let date = removeTimezoneFromGoogleDate1 &&  new Date(removeTimezoneFromGoogleDate1);
                    return date ?
                        format(date, formatString) :
                        date
                }
                let rowsBeingAdded = eventsWhichDontExistInTheSpreadsheet.map(evElement => {
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
            // Insert those events into the spreadsheet
            // Expand all filter views to encapsulate the whole spreadsheet
            // Expand all formulas to encapsulate the whole spreadsheet
        }
        await compareEventsAndSpreadsheet();
        endReplay();
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

