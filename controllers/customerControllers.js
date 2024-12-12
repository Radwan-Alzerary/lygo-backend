const jwt = require("jsonwebtoken");
const Customer = require("./models/Customer"); // Adjust the path as necessary
const FinancialAccount = require("./models/FinancialAccount"); // Adjust the path as necessary

const maxAge = 3 * 24 * 60 * 60; // Token expiration (e.g., 3 days)

// Function to create JWT token
const createToken = (id) => {
  return jwt.sign({ id }, "kishan sheth super secret key", {
    expiresIn: maxAge,
  });
};

// Register phone number directly without OTP verification
module.exports.registerPhoneNumber = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

    // Check if the customer already exists
    let customer = await Customer.findOne({ phoneNumber: phoneNumber });

    if (!customer) {
      const financialAccount = new FinancialAccount();
      await financialAccount.save();

      customer = new Customer({
        phoneNumber: phoneNumber,
        financialAccount: financialAccount._id,
      });

      await customer.save();
    }

    // Create JWT token
    const token = createToken(customer._id);

    // Set the JWT token in the response
    res.cookie("jwt", token, {
      withCredentials: true,
      httpOnly: false,
      maxAge: maxAge * 1000,
    });

    // Respond with success and the token
    res.status(200).json({
      message: "User registered successfully",
      token,
    });
  } catch (err) {
    console.error(err.message);
    const errors = handleErrors(err);
    res.status(500).json({ errors, registered: false });
  }
};
