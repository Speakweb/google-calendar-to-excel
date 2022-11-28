import {google} from 'googleapis';
import {GoogleSpreadsheet} from 'google-spreadsheet';
import {parse} from 'date-fns';

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const calendarId = process.env.CALENDAR_ID;
const sheetId = process.env.SHEET_ID;

const secondsInADay = 86400;

const timeOffsetStart = parseInt(process.env.TIME_OFFSET_START || String(secondsInADay * 31));
const timeOffsetEnd = parseInt(process.env.TIME_OFFSET_END || String(secondsInADay * 31));

(async () => {
    const runIteration = async () => {
        const calendar = google.calendar({version: 'v3', auth: credentials});
        const doc = new GoogleSpreadsheet(sheetId);
        await doc.useServiceAccountAuth(credentials);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = sheet.getRows();
        // Only take the records and events from within a month, so we don't have too many things
        const fetchAllEvents = async () => {
            const response = await calendar.events.list({
                calendarId: calendarId,
                timeMin: Date() + -timeOffsetStart,
                timeMax: Date() + -timeOffsetEnd,
                singleEvents: true,
                orderBy: 'startTime',
            });
            return response.data;
        }
        const allRecords = async () => {
            const rows = await doc.getRows({});
            // Will it give me string or date?
            // TODO filter making sure start and end date are within range
            return rows.filter(row => row.start);
        }

        const compareEventsAndSpreadsheet = async () => {
            const allSpreadsheetRecords = await allRecords();
            const allEvents = await fetchAllEvents();
            const eventsWhichDontExistInTheSpreadsheet = allEvents
                .filter(
                    event => allSpreadsheetRecords
                        .find(
                            spreadsheetRecord =>
                                spreadsheetRecord.student === event.description &&
                                // TODO fix this.  I'm pretty sure start-date will be a string
                                spreadsheetRecord.startDate === event.startDate
                        )
                );

            const recordsWhichDontExistsInTheCalendar = () => {

            }
        }
    }
})();

