const User = require("../model/user");
const jwt = require("jsonwebtoken");

const maxAge = 3 * 24 * 60 * 60;
const createToken = (id) => {
  return jwt.sign({ id }, "kishan sheth super secret key", {
    expiresIn: maxAge,
  });
};

const handleErrors = (err) => {
  let errors = { email: "", password: "" };

  console.log(err);
  if (err.message === "incorrect email") {
    errors.email = "That email is not registered";
  }

  if (err.message === "incorrect password") {
    errors.password = "That password is incorrect";
  }

  if (err.code === 11000) {
    errors.email = "Email is already registered";
    return errors;
  }

  if (err.message.includes("Users validation failed")) {
    Object.values(err.errors).forEach(({ properties }) => {
      errors[properties.path] = properties.message;
    });
  }

  return errors;
};

module.exports.cashirRegister = async (req, res, next) => {
  try {
    console.log(req.body);
    const { userName, email, password } = req.body;
    console.log(req.body);
    const user = await User.create({
      email,
      password,
      userName,
      role: "cashir",
    });
    const token = createToken(user._id);

    res.cookie("jwt", token, {
      withCredentials: true,
      httpOnly: false,
      maxAge: maxAge * 1000,
    });

    res.status(201).json({ user: user._id, created: true });
  } catch (err) {
    console.log(err);
    const errors = handleErrors(err);
    res.json({ errors, created: false });
  }
};

module.exports.register = async (req, res, next) => {
  try {
    console.log(req.body);
    const { userName, email, password, role } = req.body;
    const user = await User.create({
      email,
      password,
      userName,
      role,
    });

    const token = createToken(user._id);

    res.cookie("jwt", token, {
      withCredentials: true,
      httpOnly: false,
      maxAge: maxAge * 1000,
    });

    res.status(201).json({ user: user._id, created: true });
  } catch (err) {
    console.log(err);
    const errors = handleErrors(err);
    res.json({ errors, created: false });
  }
};

module.exports.editAcount = async (req, res, next) => {
  try {
    const userId = req.body.id; // Assuming the user ID is passed in the URL parameter
    console.log(req.body);
    // Update user information using the User.findByIdAndUpdate method or a similar method
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: req.body,
      },
      { new: true } // To get the updated user object
    );

    if (!updatedUser) {
      // Handle the case where the user with the given ID was not found
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ user: updatedUser, updated: true });
  } catch (err) {
    console.log(err);
    const errors = handleErrors(err);
    res.json({ errors, created: false });
  }
};

module.exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.login(email, password);
    const token = createToken(user._id);
    res.cookie("jwt", token, { httpOnly: false, maxAge: maxAge * 1000 });
    res.status(200).json({ user: user._id, status: true });
  } catch (err) {
    const errors = handleErrors(err);
    res.json({ errors, status: false });
  }
};
module.exports.getOne = async (req, res) => {
  try {
    const updatedCategory = await User.findById(
      req.params.id
    );
    if (!updatedCategory) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(updatedCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports.editOne = async (req, res) => {
  try {
    console.log(req.body)
    const category = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports.getAll = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    const errors = handleErrors(err);
    res.json({ errors, status: false });
  }
};
module.exports.logout = async (req, res) => {
  res.cookie("jwt", "", { maxAge: 1 });
  res.status(200).json({ message: "Logged out successfully" });
};
