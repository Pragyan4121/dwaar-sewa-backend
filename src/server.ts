import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (request, response) => {
  response.json({
    message: "Dwaar Sewa backend is working",
  });
});

app.listen(PORT, () => {
  console.log(`Dwaar Sewa server is running on port ${PORT}`);
});
