import React, { useState, useEffect, useRef } from "react";

const AutoResizingTextArea = (props) => {
  const textAreaRef = useRef(null);

  useEffect(() => {
    // Adjust the height of the textarea based on its content
    textAreaRef.current.style.height = "auto";
    textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight-20}px`;
    props.onChangeHeight(`${textAreaRef.current.scrollHeight + 20}px`);
  }, [props.message]);

  const handleChange = (event) => {
    props.onChange(event.target.value);
  };

  return (
    <textarea
      placeholder="Type your message here..."
      ref={textAreaRef}
      value={props.message}
      onChange={handleChange}
      style={{
        fontFamily: "monospace",
        fontSize: "16px",
        padding: "10px 10px 10px 10px",
        backgroundColor: "black",
        width: "100%",
        color: "white",
        maxHeight: "100px",
        borderRadius: "10px",
        border: "1px solid #ccc",
        resize: "none",
      }}
      rows="1"
    />
  );
};

export default AutoResizingTextArea;
