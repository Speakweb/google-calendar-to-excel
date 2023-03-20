import {calendarSheetConfigs, getFetchAllCalendarEvents, getTodayDateRange} from "./util";
import {getRequiredEnvironmentVariable} from "./logInfo";

const fs = require('fs');
const {Client} = require('@line/bot-sdk');

// Replace with your own credentials
const config = {
    channelAccessToken: 'YOUR_CHANNEL_ACCESS_TOKEN',
    channelSecret: 'YOUR_CHANNEL_SECRET',
};
const {
    LINE_TARGET_ID,
    LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET
} = getRequiredEnvironmentVariable(['LINE_TARGET_ID', "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"]);

const client = new Client(config);

async function sendLineMessage({userId, messageText}: { userId: string, messageText: string }) {
    const message = {
        type: 'text',
        text: messageText,
    };

    try {
        await client.pushMessage(userId, message);
        console.log('Message sent successfully');
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

(
    async () => {
        const [startDate, endDate] = getTodayDateRange();
        for (let i = 0; i < calendarSheetConfigs.length; i++) {
            const calendarSheetConfig = calendarSheetConfigs[i];
            const todaysEvents = await getFetchAllCalendarEvents({
                calendarId: calendarSheetConfig.calendarId,
                sheetTitle: calendarSheetConfig.sheetTitle,
                timeMin: startDate,
                timeMax: endDate,
            })();
            const todaysPayDates = todaysEvents.filter(e => e.summary === '花錢');
            for (let j = 0; j < todaysPayDates.length; j++) {
                const todaysPayDate = todaysPayDates[j];
                await sendLineMessage(
                    {
                        userId: LINE_TARGET_ID,
                        messageText: todaysPayDate.summary as string
                    });
            }
        }
    }
)();
