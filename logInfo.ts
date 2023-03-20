import debug from "debug";

export const logInfo = debug('calendar-to-sheet:info:')
export const logRowsAdded = debug('calendar-to-sheet:rows-added:')
export const logConfig = debug('calendar-to-sheet:config:');
export const secondsInADay = 86400;
export const getRequiredEnvironmentVariable = <T extends {}>(keys: (keyof T)[]): T => {
    const fromEntries = Object.fromEntries(
        keys.map(key => [key, process.env[key] as string])
    ) as T;
    logConfig(JSON.stringify(fromEntries));
    return fromEntries
}