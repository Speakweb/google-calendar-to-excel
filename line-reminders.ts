import {allEnvironmentVariables, getFetchAllCalendarEvents} from "./util";

const fs = require('fs');
const { Client } = require('@line/bot-sdk');

// Replace with your own credentials
const config = {
    channelAccessToken: 'YOUR_CHANNEL_ACCESS_TOKEN',
    channelSecret: 'YOUR_CHANNEL_SECRET',
};

const client = new Client(config);

async function sendLineMessage({userId, messageText}:{userId: string, messageText: string}) {
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

/*
(
    async () => {
        for (let i = 0; i < todaysEvents.length; i++) {
            const todaysEvent = todaysEvents[i];
            const messageText = `Today's event: ${todaysEvent.title}`;
        }
        const targetUserId = 'TARGET_USER_ID';
        const todaysEvents = getFetchAllCalendarEvents({calendarId: allEnvironmentVariables.}
        todaysEvents.forEach((event) => {
            sendLineMessage(targetUserId, `Today's event: ${event.title}`);
        });
    }
)();
*/
