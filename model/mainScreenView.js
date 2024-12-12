const mongoose = require("mongoose");
const mainScreenViewSchema = new mongoose.Schema(
  {
    textRandom: [
      {
        title: { type: String },
        size: { type: Number, default: 1 },
        color: { type: String, default: "#000" },
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
      },
    ],
    visitNumberText: {
      color: { type: String ,default:"#fff"},
      size: { type: Number ,default:17},
      x: { type: Number, default: 50 },
      y: { type: Number, default: 50 },
    },
    backgroundImg: { type: String,default: "img/background.png"  },
  },
  {
    timestamps: true,
  }
);
const MainScreenView = mongoose.model("MainScreenView", mainScreenViewSchema);

module.exports = MainScreenView;
