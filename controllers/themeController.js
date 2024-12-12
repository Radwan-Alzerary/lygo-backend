const Theme = require('../model/themeSchema');

// Create a new theme
exports.createTheme = async (req, res) => {
  try {
    const theme = new Theme(req.body);
    await theme.save();
    res.status(201).json(theme);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all themes
exports.getAllThemes = async (req, res) => {
  try {
    const themes = await Theme.find();
    res.json(themes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a theme
exports.updateTheme = async (req, res) => {
  try {
    const theme = await Theme.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!theme) return res.status(404).send('Theme not found');
    res.json(theme);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a theme
exports.deleteTheme = async (req, res) => {
  try {
    const theme = await Theme.findByIdAndDelete(req.params.id);
    if (!theme) return res.status(404).send('Theme not found');
    res.json({ message: 'Theme deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
