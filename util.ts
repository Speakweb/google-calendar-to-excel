import {getRequiredEnvironmentVariable, logInfo} from "./logInfo.js";
import fs from "fs";
import {google} from "googleapis";

export const getAllEnvironmentVariables = () => {
    const {
        REPLAY,
        GOOGLE_CREDENTIALS,
        CALENDAR_SHEET_CONFIGURATIONS,
        SHEET_ID,
        TIME_OFFSET_START,
        TIME_OFFSET_END,
        RUN_INTERVAL,
        SERVICE_PAUSED
    } = getRequiredEnvironmentVariable([
        'REPLAY',
        'GOOGLE_CREDENTIALS',
        'CALENDAR_SHEET_CONFIGURATIONS',
        'SHEET_ID',
        'TIME_OFFSET_START',
        'TIME_OFFSET_END',
        'RUN_INTERVAL',
        'SERVICE_PAUSED'
    ])
    return {
        REPLAY,
        GOOGLE_CREDENTIALS,
        CALENDAR_SHEET_CONFIGURATIONS,
        SHEET_ID,
        TIME_OFFSET_START,
        TIME_OFFSET_END,
        RUN_INTERVAL,
        SERVICE_PAUSED
    };
};

export const allEnvironmentVariables = getAllEnvironmentVariables();

export const jsonCredentials = JSON.parse(allEnvironmentVariables.GOOGLE_CREDENTIALS as string);
export const fromJsonCredentials = google.auth.fromJSON(jsonCredentials);

// @ts-ignore
fromJsonCredentials.scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events"
];

export let newReplayMap: Record<string, any> = {};
export const replayableFunction = <T>(key: string, f: () => Promise<T>): () => Promise<T> => async () => {
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
export const startReplay = () => {
    newReplayMap = {};
}
export const endReplay = () => {
    if (!isReplaying) {
        fs.writeFileSync(replayMapPath, JSON.stringify(newReplayMap, undefined, '\t'));
    }
}
export const isReplaying = allEnvironmentVariables.REPLAY === 'true';
export const replayMapPath = './replay.json';
export const calendar = google.calendar({version: 'v3', auth: fromJsonCredentials});
export const getFetchAllCalendarEvents = (
    {
        calendarId,
        sheetTitle,
        timeMin,
        timeMax
    }: { calendarId: string, sheetTitle: string, timeMin: Date, timeMax: Date }) =>
    replayableFunction(`calendarEvents-${calendarId}-${sheetTitle}`, async () => {
        const response = await calendar.events.list({
                calendarId,
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 2500
            },
            {}
        )
        if (!response.data.items) {
            logInfo(`Something went wrong fetching events from calendar ${calendarId}`);
        }
        logInfo(`Fetched ${response.data.items?.length} events from calendar`);
        // Filter out items with no summary, we can ignore those
        return response.data.items?.filter(item => item.summary) || [];
    });

export const calendarSheetConfigs = JSON.parse(allEnvironmentVariables.CALENDAR_SHEET_CONFIGURATIONS as string) as CalendarSheetConfig[];
export type CalendarSheetConfig = {
    sheetTitle: string;
    calendarId: string;
}
export type SpreadsheetRowType = {
    Start: string,
    Student: string
};
export const getTodayDateRange = () => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 0, -1);
    return [startOfDay, endOfDay];
};
