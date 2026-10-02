// Loads .env first: ES module imports run before the code in this file,
// so dotenv must be imported (not called) to take effect for app.js.
import "dotenv/config";
import "./config/env.js";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

app.listen(PORT, () => {
  console.log(`RentAny backend running on http://localhost:${PORT}`);
});
