import * as functions from "firebase-functions";

// The Firebase Admin SDK to access Firestore.
import * as admin from "firebase-admin";

import { Configuration, OpenAIApi } from "openai";

admin.initializeApp();

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Listens for new messages added to /messages/:documentId/message
exports.getReply = functions
    .runWith({ secrets: ["OPENAI_API_KEY"] })
    .firestore.document("/messages/{documentId}")
    .onCreate(async (snap, context) => {
        // Grab the current value of what was written to Firestore.
        const message = snap.data().message;

        // Access the parameter `{documentId}` with `context.params`
        functions.logger
            .log("Getting Reply for", context.params.documentId, message);

        const reply = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: message,
            // max_tokens: 7,
            temperature: 0.5,
            // top_p: 1,
            // n: 1,
            // stream: false,
            // logprobs: null,
            // stop: "\n"
        });

        // You must return a Promise when performing asynchronous tasks
        // inside a Functions such as writing to Firestore.
        // Setting an 'reply' field in Firestore document returns a Promise.
        return snap.ref.set({ reply }, { merge: true });
    });
