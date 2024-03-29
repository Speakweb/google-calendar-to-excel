import {calendar_v3} from 'googleapis';
import {GoogleSpreadsheet} from 'google-spreadsheet';
import {config} from 'dotenv';
import {add, format, isWithinInterval, parse, sub} from 'date-fns';
import {logInfo, logRowsAdded, secondsInADay} from "./logInfo.js";

import {
    allEnvironmentVariables,
    calendarSheetConfigs,
    endReplay,
    getFetchAllCalendarEvents,
    jsonCredentials,
    replayableFunction,
    SpreadsheetRowType,
    startReplay
} from "./util.js";

config()

const formatString = "yyyy/MM/dd H:mm:ss";

const {
    REPLAY,
    GOOGLE_CREDENTIALS,
    CALENDAR_SHEET_CONFIGURATIONS,
    SHEET_ID,
    TIME_OFFSET_START,
    TIME_OFFSET_END,
    RUN_INTERVAL,
    SERVICE_PAUSED
} = allEnvironmentVariables;

const docId = SHEET_ID as string;
const timeOffsetStart = parseInt(TIME_OFFSET_START || String(secondsInADay * 31));
const timeOffsetEnd = parseInt(TIME_OFFSET_END || String(secondsInADay * 31));
const runInterval = parseInt(RUN_INTERVAL || "60000");




const parseSpreadsheetDate = (dateStr: string) => parse(dateStr, formatString, new Date());


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
        const doc = new GoogleSpreadsheet(docId);
        logInfo(`Authenticating document`)
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
            logInfo(`Adding events for ${calendarId} ${sheetTitle}`)
            // Only take the records and events from within a month, so we don't have too many things
            const fetchAllCalendarEvents = getFetchAllCalendarEvents({
                calendarId,
                timeMin: getMinDate(),
                timeMax: getMaxDate(),
                sheetTitle
            })
            const fetchAllSpreadsheetRecords = replayableFunction(`spreadsheetRecords-${calendarId}-${sheetTitle}`, async () => {
                logInfo(`Getting rows from sheet...`)
                // @ts-ignore
                return (await sheet.getRows()).map((r: SpreadsheetRowType) => ({Student: r.Student, Start: r.Start}));
            })
            const filterSpreadsheetRows = (rawRows: SpreadsheetRowType[]) => {
                const rows: SpreadsheetRowHelper[] = rawRows.map(row => new SpreadsheetRowHelper(row))
                logInfo(`fetched ${rows.length} rows from sheet.  Filtering rows...`)
                const filteredRows = rows.filter(row => row.isWithinDateRange());
                logInfo(`${filteredRows.length} rows left after filter`)
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
                        logInfo(`No events to insert into spreadsheet`);
                        return;
                    }
                    logInfo(`Adding ${eventsWhichDontExistInTheSpreadsheet.length} rows to spreadsheet...`);
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
                    logInfo(`Added ${result.length} rows to spreadsheet.`);
                    logRowsAdded(JSON.stringify(rowsBeingAdded))
                }
                await insertRecordsIntoSpreadsheet()
            }
            await compareEventsAndSpreadsheet();
            endReplay();
        }

    }
    if (SERVICE_PAUSED === 'true') {
        console.log(`service paused, exiting`)
        return;
    }
    while (true) {
        try {
            logInfo(`running iteration...`)
            await runIteration();
        } catch (e) {
            console.error(e)
        }
        logInfo(`Finished iteration.  Waiting ${runInterval}ms`)
        await new Promise(resolve => setTimeout(resolve, runInterval))
    }
})();

