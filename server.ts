import {google} from 'googleapis';
import {GoogleSpreadsheet} from 'google-spreadsheet';
import {config} from 'dotenv';
import {parse, isWithinInterval} from 'date-fns';


// 11/24/2022 20:35:00
const parseSpreadsheetDate = (dateStr: string) => parse(dateStr, "MM/dd/yyyy H:mm:ss", new Date());

config()

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS as string);
const calendarId = process.env.CALENDAR_ID as string;
const sheetId = process.env.SHEET_ID as string;

const secondsInADay = 86400;

const timeOffsetStart = parseInt(process.env.TIME_OFFSET_START || String(secondsInADay * 31));
const timeOffsetEnd = parseInt(process.env.TIME_OFFSET_END || String(secondsInADay * 31));

type SpreadsheetRowType = {
    Start: string,
    Student: string
};

const shouldBeFiltered = (date: Date) => {
    return !isWithinInterval(date, {
        start: new Date(((new Date().getTime() / 1000) - timeOffsetStart) * 1000),
        end: new Date(((new Date().getTime() / 1000) + timeOffsetEnd) * 1000)
    })
}

class SpreadsheetRowHelper {
    constructor(public r: SpreadsheetRowType) {
    }

    shouldBeFiltered() {
        return shouldBeFiltered(this.Start())
    }

    Start() {
        return parseSpreadsheetDate(this.r.Start);
    }
}

(async () => {
    const runIteration = async () => {
        const calendar = google.calendar({version: 'v3', auth: credentials});
        const doc = new GoogleSpreadsheet(sheetId);
        await doc.useServiceAccountAuth(credentials);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        // Only take the records and events from within a month, so we don't have too many things
        const fetchAllEvents = async () => {
            const response = await calendar.events.list({
                calendarId,
                timeMin: Date().getTime() - (timeOffsetStart * 1000),
                timeMax: Date().getTime() + (timeOffsetEnd * 1000),
                singleEvents: true,
                orderBy: 'startTime',
            });
            return response?.data?.items || [];
        }
        const allRecords = async () => {
            // @ts-ignore
            const rows: SpreadsheetRowType[] = (await doc.getRows({})).map(row => SpreadsheetRowHelper(row));
            // Will it give me string or date?
            // TODO filter making sure start and end date are within range
            return rows.filter(row => row.Start);
        }

        const compareEventsAndSpreadsheet = async () => {
            const allSpreadsheetRecords = await allRecords();
            const allEvents = await fetchAllEvents();
            const eventsWhichDontExistInTheSpreadsheet = allEvents
                .filter(
                    event => allSpreadsheetRecords
                        .find(
                            spreadsheetRecord =>
                                spreadsheetRecord.Student === event.description &&
                                // TODO fix this.  I'm pretty sure start-date will be a string
                                spreadsheetRecord.Start === event.start
                        )
                );

            const recordsWhichDontExistsInTheCalendar = () => {

            }
        }
    }
    runIteration();
})();

