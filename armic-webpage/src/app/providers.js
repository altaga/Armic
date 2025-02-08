"use client";
import { resetServerVars } from "@/api/mqtt-server";
import { ThemeProvider } from "@emotion/react";
import { createTheme } from "@mui/material";
import { lightBlue, lightGreen } from "@mui/material/colors";

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
  resetServerVars().then(() => console.log("Servers started"));
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
