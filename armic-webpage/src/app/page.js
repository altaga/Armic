"use client";
import { getState, promptChat } from "@/api/mqtt-server";
import AutoResizingTextArea from "@/components/autoResTextArea";
import { Button, TextField } from "@mui/material";
import { useEffect, useState } from "react";

export default function Home() {
  const [buttonText, setButtonText] = useState("Send");
  const [message, setMessage] = useState("");
  const [state, setState] = useState({}); // Shared state
  const [prevstate, setPrevState] = useState({});
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    const interval = setInterval(async () => {
      setState(await getState());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (JSON.stringify(prevstate) === JSON.stringify(state)) return;
    setPrevState(state);
    if (state["webpage/input"] !== undefined) {
      console.log(state["webpage/input"]);
      const len = messages.length;
      if (state["webpage/input"] !== messages[len - 1]) {
        let temp = messages;
        temp.push({
          ai: true,
          timestamp: new Date().getTime(),
          message: state["webpage/input"],
        });
        temp.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(temp);
      }
    }
  }, [state]);

  return (
    <div
      style={{
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "white",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "50%",
          width: "50%",
          overflow: "hidden",
        }}
      >
        {messages.map((message, index) => (
          <div key={index} style={{}}>
            <div
              style={{
                background: message.ai ? "lightblue" : "lightgreen",
                padding: "10px",
                borderRadius: "10px",
                margin: "10px",
              }}
            >
              {message.message}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "0",
          width: "100%",
          justifyContent: "center",
          display: "flex",
        }}
      >
        <AutoResizingTextArea onChange={(value) => setMessage(value)} />
        <Button
          variant="contained"
          color="primary"
          onClick={() => promptChat("structured", message)}
        >
          {buttonText}
        </Button>
      </div>
    </div>
  );
}
