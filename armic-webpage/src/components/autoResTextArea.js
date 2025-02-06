import React, { useState, useEffect, useRef } from "react";

const AutoResizingTextArea = (props) => {
  const [text, setText] = useState("");
  const textAreaRef = useRef(null);

  useEffect(() => {
    // Adjust the height of the textarea based on its content
    textAreaRef.current.style.height = "auto";
    textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
  }, [text]);

  const handleChange = (event) => {
    setText(event.target.value);
    props.onChange(event.target.value);
  };

  return (
    <textarea
      ref={textAreaRef}
      value={text}
      onChange={handleChange}
      style={{
        fontFamily: "Roboto Mono",
        fontSize: "16px",
        padding: "20px 10px 0px 10px",
        backgroundColor: "black",
        width: "50%",
        color: "white",
        maxHeight: "100px",
        borderRadius: "5px",
        border: "1px solid #ccc",
        resize: "none",
      }}
      rows="1"
    />
  );
};

export default AutoResizingTextArea;
