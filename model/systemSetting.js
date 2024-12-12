const mongoose = require("mongoose");
const SystemSettingSchema = new mongoose.Schema(
  {
    name: { type: String },
    screenImg: { type: String, default: "img/background.png", require },

    screenAdv: [
      {
        text: { type: String },
        advType: { type: String },
        speed: { type: String },
        color: { type: String },
        fontType: { type: String },
        x: { type: Number },
        y: { type: Number },
      },
    ],
  },
  {
    timestamps: true,
  }
);
const SystemSetting = mongoose.model("SystemSetting", SystemSettingSchema);

module.exports = SystemSetting;
