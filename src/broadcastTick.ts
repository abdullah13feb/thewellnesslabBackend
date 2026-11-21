// Lambda entry for scheduled WhatsApp broadcasts. EventBridge invokes it every minute (serverless.yml,
// function broadcastTick). Each run sends the messages due in the next ~50 seconds at their exact times,
// then exits before the next tick. When nothing is due it returns after one database query.
import dotenv from "dotenv";
import { dispatchDueRecipients } from "./lib/broadcastDispatch.js";

dotenv.config();

export const handler = async () => {
  const result = await dispatchDueRecipients({ budgetMs: 50000 });
  if (result.sent || result.failed || result.completed) console.log("Broadcast tick:", JSON.stringify(result));
  return result;
};
