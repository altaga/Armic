"use client";
import { getState, promptChat } from "@/api/mqtt-server";
import AutoResizingTextArea from "@/components/autoResTextArea";
import SendIcon from "@mui/icons-material/Send";
import { Button } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import Linkify from "react-linkify";

function exerciseCheck(message) {
  let temp = JSON.parse(message);
  if (Object.keys(temp)[0] === "baseline") {
    return "None";
  } else if (Object.keys(temp)[0] === "efe") {
    return "Elbow Flexion Extension";
  } else if (Object.keys(temp)[0] === "ef") {
    return "Elbow Flexion";
  } else if (Object.keys(temp)[0] === "al") {
    return "Arm Lift";
  }
  return "";
}

export default function Home() {
  // Refs
  const scrollableRef = useRef(null);
  // States
  const [exerciseFlag, setExerciseFlag] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState({}); // Shared state
  const [prevstate, setPrevState] = useState({});
  const [messages, setMessages] = useState([]);
  const [height, setHeight] = useState("0px");
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
      const len = messages.length;
      if (state["webpage/input"] !== messages[len - 1]?.message) {
        let temp = messages;
        temp.push({
          ai: true,
          timestamp: new Date().getTime(),
          message: state["webpage/input"],
        });
        temp.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(temp);
        setTimeout(() => {
          scrollableRef.current.scrollTop = scrollableRef.current.scrollHeight;
        }, 50);
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
        justifyContent: "flex-start",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          justifyContent: "center",
          alignItems: "center",
          left: "0",
          top: "0",
          width: "24%",
          height: "100%",
          background: "#0a0a0a",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: "1.2rem",
            textAlign: "center",
            fontFamily: "monospace",
          }}
        >
          Last Detected Exercise: <br />
          {state["esp32/output"] !== undefined
            ? exerciseCheck(state["esp32/output"])
            : "None"}
        </div>
      </div>
      <div
        ref={scrollableRef}
        style={{
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          height: "90%",
          marginBottom: height,
          minHeight: "82%",
          width: "51%",
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {messages.map((message, index) => (
          <div
            key={index}
            style={{
              fontFamily: "monospace",
              whiteSpace: "pre-line",
              fontSize: "1.1rem",
              textAlign: "justify",
              wordBreak: "break-word",
              background: message.ai ? "lightblue" : "lightgreen",
              padding: "20px",
              borderRadius: `${message.ai ? "0" : "20"}px ${
                message.ai ? "20" : "0"
              }px 20px 20px`,
              marginBottom: "20px",
              alignSelf: message.ai ? "flex-start" : "flex-end",
              width: "70%",
            }}
          >
            <Linkify
              properties={{ target: "_blank", style: { fontWeight: "bold" } }}
            >
              {message.message}
            </Linkify>
            {message.ai && !exerciseFlag && <br />}
            {message.ai && !exerciseFlag && (
              <Button
                style={{
                  alignSelf: "flex-end",
                  marginTop: "10px",
                }}
                variant="contained"
                color="executeButton"
                onClick={() => {
                  let temp = messages;
                  temp.push({
                    ai: false,
                    timestamp: new Date().getTime(),
                    message: "Execute Exercise",
                  });
                  temp.sort((a, b) => a.timestamp - b.timestamp);
                  setMessages(temp);
                  setExerciseFlag(true);
                  promptChat("exercise", "Execute Exercise");
                }}
              >
                {" "}
                Execute Exercise
              </Button>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "10px",
          width: "50%",
          justifyContent: "center",
          display: "flex",
        }}
      >
        <AutoResizingTextArea
          message={message}
          onChange={(value) => setMessage(value)}
          onChangeHeight={(value) => setHeight(value)}
        />
        <Button
          style={{
            alignSelf: "flex-end",
            margin: "0px 0px 0px 10px",
            aspectRatio: "1",
            height: "auto",
            width: "40px",
            borderRadius: "40px",
            justifyContent: "center",
            alignItems: "center",
          }}
          variant="contained"
          color="myButton"
          onClick={() => {
            let temp = messages;
            temp.push({
              ai: false,
              timestamp: new Date().getTime(),
              message: message,
            });
            temp.sort((a, b) => a.timestamp - b.timestamp);
            setMessages(temp);
            setMessage("");
            setTimeout(() => {
              scrollableRef.current.scrollTop =
                scrollableRef.current.scrollHeight;
            }, 50);
            promptChat("structured", message);
          }}
        >
          <SendIcon style={{ fontSize: "2rem" }} />
        </Button>
      </div>
    </div>
  );
}
