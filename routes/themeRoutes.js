const express = require('express');
const router = express.Router();
const themeController = require('../controllers/themeController');

router.post('/', themeController.createTheme);
router.get('/', themeController.getAllThemes);
router.put('/:id', themeController.updateTheme);
router.delete('/:id', themeController.deleteTheme);

module.exports = router;

 