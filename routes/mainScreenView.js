const MainScreenView = require("../model/mainScreenView");
const multer = require("multer");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./public/img");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = file.originalname.split(".").pop();
    cb(null, uniqueSuffix + "." + extension);
  },
});

// Create multer instance for uploading image
const upload = multer({ storage: storage });

const router = require("express").Router();

router.get("/getstyle", async (req, res) => {
  try {
    const medicalReportsStype = await MainScreenView.find({
      name: "prescriptionReports",
    });
    res.json(medicalReportsStype);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post("/update", async (req, res) => {
  try {
    const medicalReportsStype = await MainScreenView.findByIdAndUpdate(
      req.body.id,
      req.body.data
    );
    if (!medicalReportsStype) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(medicalReportsStype);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  "/backgroundImage",
  upload.single("image"),
  async (req, res, next) => {
    console.log(req.body);
    const { filename, path } = req.file;
    const { name } = req.body;
    console.log(filename, path, name);
    const url = req.protocol + "://" + req.get("host");
    const imagePath = req.file ? "/img/" + req.file.filename : null;
    console.log(imagePath);
    try {
      const medicalReportsStype = await MainScreenView.findOneAndUpdate(
        {},
        { backgroundImg: imagePath }
      );
      if (!medicalReportsStype) {
        return res.status(404).json({ error: "Category not found" });
      }
      res.json(medicalReportsStype);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post("/textRandom", async (req, res, next) => {
  try {
    let update = "";
    update = { $push: { textRandom: {} } };
    console.log(req.body);
    const updatedDocument = await MainScreenView.findByIdAndUpdate(
      req.body.id,
      update,
      { new: true } // This option returns the updated document
    );
    res.json(updatedDocument);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/updatetextRandom", async (req, res) => {
  try {
    console.log(req.body);
    // Find the document by its ID
    const doc = await MainScreenView.findById(req.body.id);

    // Check if the document was found
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }
    if (req.body.text == "title") {
      doc.textRandom[req.body.index].title = req.body.data;
    } else if (req.body.text == "size") {
      doc.textRandom[req.body.index].size = req.body.data;
    } else if (req.body.text == "x") {
      doc.textRandom[req.body.index].x = req.body.data;
    } else if (req.body.text == "y") {
      doc.textRandom[req.body.index].y = req.body.data;
    } else if (req.body.text == "color") {
      doc.textRandom[req.body.index].color = req.body.data;
    }
    await doc.save();

    return res.status(200).json({
      message: "Element updated successfully",
      updatedElement: doc.textRandom[req.body.index],
    });
  } catch (error) {
    console.error("Error updating element:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
