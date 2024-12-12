const mongoose = require("mongoose");
const SettingSchema = new mongoose.Schema(
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
      color: { type: String },
      size: { type: String },
      x: { type: Number, default: 50 },
      y: { type: Number, default: 50 },
    },
    backgroundImage: { type: String,default: "img/background.png" },
  },
  {
    timestamps: true,
  }
);
const Setting = mongoose.model("Setting", SettingSchema);

module.exports = Setting;
