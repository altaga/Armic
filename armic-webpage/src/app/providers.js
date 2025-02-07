"use client";
import { ThemeProvider } from "@emotion/react";
import { createTheme } from "@mui/material";
import { lightBlue, lightGreen } from "@mui/material/colors";
import { dark } from "@mui/material/styles/createPalette";
import React from "react";

const theme = createTheme({
  palette: {
    myButton: {
      dark: lightGreen[150],
      main: lightBlue[100],
      light: lightBlue[50],
    },
    executeButton: {
      main: lightBlue[300],
    },
  },
});

export default function Providers({ children }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
