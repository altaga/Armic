"use server";
import mqtt from "mqtt";

// Stateful Server
let state = {};

const settings = {
  port: process.env.MQTT_PORT,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
};

const host = process.env.MQTT_BROKER_URL;
const topics = ["esp32/output", "webpage/input"];

// MQTT server
const client = mqtt.connect(host, settings);
// MQTT Server Connection
client.on("connect", () => {
  topics.forEach((topic) =>
    client.subscribe(topic, (err) =>
      err ? console.log(err) : console.log(`Subscribed to ${topic}`)
    )
  );
  client.on("message", (topic, message) => {
    state = {
      ...state,
      [topic]: message.toString(),
    };
  });
});

export async function startServers() {
  return "Servers started";
}

export async function resetServerVars() {
  state = {};
  return "Servers Restarted";
}

export async function getState() {
  return state;
}

export async function promptChat(command, message) {
  client.publish(
    "webpage/output",
    JSON.stringify({
      command,
      message,
    })
  );
}
