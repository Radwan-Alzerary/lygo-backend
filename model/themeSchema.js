const mongoose = require('mongoose');

const themeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  backgroundFile: { type: String}, // URL or path to the file
  text: { type: String, required: true },
  mainTextSize: { type: Number, required: true },
  secondaryTextSize: { type: Number, required: true },
});

const Theme = mongoose.model('Theme', themeSchema);
module.exports = Theme;
