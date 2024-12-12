// server.js

const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");
const session = require("express-session");
const mongoose = require("mongoose");
const winston = require('winston');

// Initialize Winston logger
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

// Load environment variables
require("dotenv").config();

// -------------- DATABASE CONNECTION --------------
mongoose.set("strictQuery", false);

const devConnection = process.env.DB_STRING;
const prodConnection = process.env.DB_STRING_PROD;

// Connect to the correct environment database
mongoose.connect(process.env.NODE_ENV === 'production' ? prodConnection : devConnection, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    logger.info('Database connected');

    // Import models after successful DB connection
    require("./model/user");
    const Ride = require("./model/ride");
    const Captain = require("./model/Driver");
    const Auditors = require("./model/auditors");
    const MainScreenView = require("./model/mainScreenView");

    // Initialize Express app and HTTP server
    const app = express();
    const server = http.createServer(app);

    // Initialize Redis client
    const redisClient = createClient({
      url: "redis://127.0.0.1:6379",
    });

    redisClient.on("error", (err) => {
      logger.error("Redis error:", err);
    });

    redisClient
      .connect()
      .then(() => {
        logger.info("Connected to Redis");
      })
      .catch((err) => {
        logger.error("Redis connection error:", err);
        process.exit(1); // Exit if Redis connection fails
      });

    // Initialize Socket.IO
    const io = require("socket.io")(server, {
      cors: {
        origin: "*",
        credentials: true,
      },
    });

    // Object to keep track of online users and their socket IDs
    const onlineCustomers = {};
    const onlineCaptains = {};

    // Map to keep track of dispatch processes
    const dispatchProcesses = new Map();

    // Map to keep track of captain-customer ride sharing
    const rideSharingMap = new Map();

    // Function to find nearby captains using Redis geospatial commands
    const findNearbyCaptains = async (origin, radius = 2) => {
      try {
        const nearbyCaptains = await redisClient.sendCommand([
          "GEORADIUS",
          "captains",
          origin.longitude.toString(),
          origin.latitude.toString(),
          radius.toString(),
          "km",
          "WITHCOORD",
          "WITHDIST",
          "ASC",
        ]);

        // Transform the result into an array of captain IDs
        return nearbyCaptains.map((captainData) => captainData[0]);
      } catch (err) {
        logger.error("Error in findNearbyCaptains:", err);
        throw err;
      }
    };

    // Function to calculate the distance between two coordinates
    function calculateDistance(coord1, coord2) {
      const toRad = (value) => (value * Math.PI) / 180;
      const R = 6371; // Earth's radius in km

      const dLat = toRad(coord2.latitude - coord1.latitude);
      const dLon = toRad(coord2.longitude - coord1.longitude);

      const lat1 = toRad(coord1.latitude);
      const lat2 = toRad(coord2.latitude);

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) *
          Math.sin(dLon / 2) *
          Math.cos(lat1) *
          Math.cos(lat2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c; // Distance in km
    }

    // Socket.IO namespace for customers
    const customerNamespace = io.of("/customer");
    customerNamespace.on("connection", (socket) => {
      const token = socket.handshake.query.token;

      // Verify JWT token
      jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
        if (err) {
          logger.warn("JWT verification failed for customer");
          socket.disconnect();
        } else {
          const customerId = decoded.id;
          onlineCustomers[customerId] = socket.id;

          logger.info(`Customer ${customerId} connected with socket ID ${socket.id}`);

          // Check for rides that need to notify the customer
          try {
            const rides = await Ride.find({
              passenger: customerId,
              status: { $in: ['accepted', 'notApprove', 'cancelled', 'arrived', 'onRide', 'completed'] },
              notified: { $ne: true },
            });

            for (const ride of rides) {
              // Send appropriate notifications based on ride status
              if (ride.status === 'accepted') {
                // Fetch captain's info
                const captainInfo = await Captain.findById(ride.driver);

                socket.emit("rideAccepted", {
                  rideId: ride._id,
                  driverId: ride.driver,
                  driverInfo: {
                    name: captainInfo.name,
                    vehicle: captainInfo.carDetails,
                    phoneNumber: captainInfo.phoneNumber,
                  },
                });
              } else if (ride.status === 'arrived') {
                socket.emit("driverArrived", {
                  rideId: ride._id,
                  message: "Your captain has arrived.",
                });
              } else if (ride.status === 'onRide') {
                socket.emit("rideStarted", {
                  rideId: ride._id,
                });
              } else if (ride.status === 'completed') {
                socket.emit("rideCompleted", {
                  rideId: ride._id,
                  message: "Your ride has been completed. Thank you for riding with us.",
                });
              } else if (ride.status === 'notApprove') {
                socket.emit("rideNotApproved", {
                  rideId: ride._id,
                  message: "No captains accepted your ride within 10 minutes.",
                });
              } else if (ride.status === 'cancelled') {
                socket.emit("rideCanceled", {
                  rideId: ride._id,
                  message: "Your ride was cancelled.",
                });
              }

              // Mark the ride as notified
              ride.notified = true;
              await ride.save();
            }
          } catch (err) {
            logger.error("Error notifying customer about rides:", err);
          }

          // Listen for ride requests from customer
          socket.on("requestRide", async (rideData) => {
            try {
              if (
                typeof rideData.origin.latitude === "number" &&
                typeof rideData.origin.longitude === "number" &&
                typeof rideData.destination.latitude === "number" &&
                typeof rideData.destination.longitude === "number"
              ) {
                // Create a new ride instance
                const newRide = new Ride({
                  passenger: customerId,
                  driver: null,
                  pickupLocation: {
                    coordinates: [
                      rideData.origin.longitude,
                      rideData.origin.latitude,
                    ],
                  },
                  dropoffLocation: {
                    coordinates: [
                      rideData.destination.longitude,
                      rideData.destination.latitude,
                    ],
                  },
                  fare: {
                    amount: 6000,
                    currency: "IQD",
                  },
                  distance: rideData.distance,
                  duration: rideData.duration,
                  status: "requested",
                });

                // Save the new ride to MongoDB
                await newRide.save();
                logger.info(`Ride created for customer ${customerId}`);

                // Start the dispatch process
                // Mark ride as dispatching
                newRide.isDispatching = true;
                await newRide.save();

                dispatchRide(newRide, rideData.origin);
              } else {
                socket.emit(
                  "rideError",
                  "Invalid location data. Please try again."
                );
              }
            } catch (err) {
              logger.error("Error creating or broadcasting ride:", err);
              socket.emit(
                "rideError",
                "Failed to create ride. Please try again."
              );
            }
          });

          socket.on("disconnect", () => {
            logger.info("A customer disconnected");
            for (let id in onlineCustomers) {
              if (onlineCustomers[id] === socket.id) {
                delete onlineCustomers[id];
                logger.info(`Customer ${id} disconnected`);
                break;
              }
            }
          });
        }
      });
    });

    // Socket.IO namespace for captains
    const captainNamespace = io.of("/captain");
    captainNamespace.on("connection", (socket) => {
      const token = socket.handshake.query.token;

      // Verify JWT token
      jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
        if (err) {
          logger.warn("JWT verification failed for captain");
          socket.disconnect();
        } else {
          const captainId = decoded.id;
          onlineCaptains[captainId] = socket.id;

          logger.info(`Captain ${captainId} connected with socket ID ${socket.id}`);

          // Check if the captain has any ongoing rides
          Ride.findOne({
            driver: captainId,
            status: { $in: ['accepted', 'arrived', 'onRide'] },
          })
            .then((ride) => {
              if (ride) {
                // Send the ride details to the captain
                socket.emit("restoreRide", {
                  rideId: ride._id,
                  pickupLocation: ride.pickupLocation.coordinates,
                  dropoffLocation: ride.dropoffLocation.coordinates,
                  fare: ride.fare.amount,
                  distance: ride.distance,
                  duration: ride.duration,
                  status: ride.status,
                });
              } else {
                // Send any pending ride requests within the captain's area
                redisClient.geoPos("captains", captainId).then(async (captainLocation) => {
                  if (captainLocation && captainLocation.length > 0 && captainLocation[0]) {
                    logger.info(`Captain ${captainId} is at location:`, captainLocation[0]);
                    const [longitude, latitude] = captainLocation[0];
                    const pendingRides = await Ride.find({ status: "requested" });

                    for (let ride of pendingRides) {
                      const distance = calculateDistance(
                        { latitude, longitude },
                        {
                          latitude: ride.pickupLocation.coordinates[1],
                          longitude: ride.pickupLocation.coordinates[0],
                        }
                      );
                      if (distance <= 10) {
                        // Send the ride request to the captain
                        socket.emit("newRide", {
                          rideId: ride._id,
                          pickupLocation: ride.pickupLocation.coordinates,
                          dropoffLocation: ride.dropoffLocation.coordinates,
                          fare: ride.fare.amount,
                          distance: ride.distance,
                          duration: ride.duration,
                        });
                      }
                    }
                  }
                }).catch((err) => {
                  logger.error("Error fetching captain location:", err);
                });
              }
            })
            .catch((err) => {
              logger.error("Error fetching ongoing ride for captain:", err);
            });

          // Listen for location updates from captain
          socket.on("updateLocation", async (data) => {
            try {
              await redisClient.geoAdd("captains", {
                longitude: data.longitude,
                latitude: data.latitude,
                member: captainId,
              });
              logger.info(`Location for captain ${captainId} updated in Redis`);

              // Send captain's location to the associated customer if on an active ride
              if (rideSharingMap.has(captainId)) {
                const customerId = rideSharingMap.get(captainId);
                if (onlineCustomers[customerId]) {
                  customerNamespace
                    .to(onlineCustomers[customerId])
                    .emit("driverLocationUpdate", {
                      latitude: data.latitude,
                      longitude: data.longitude,
                    });
                }
              }
            } catch (err) {
              logger.error("Error saving location to Redis:", err);
            }
          });

          // Listen for captain accepting ride
          socket.on("acceptRide", async (rideId) => {
            try {
              const ride = await Ride.findOneAndUpdate(
                { _id: rideId, status: "requested" },
                { $set: { status: "accepted", driver: captainId } },
                { new: true }
              );

              if (ride) {
                // Ride was successfully updated
                logger.info(`Captain ${captainId} accepted ride ${rideId}`);

                // Fetch captain's info from the database
                const captainInfo = await Captain.findById(captainId);

                // Notify the customer with captain's info
                if (onlineCustomers[ride.passenger]) {
                  customerNamespace
                    .to(onlineCustomers[ride.passenger])
                    .emit("rideAccepted", {
                      rideId: ride._id,
                      driverId: captainId,
                      driverInfo: {
                        name: captainInfo.name,
                        vehicle: captainInfo.carDetails,
                        phoneNumber: captainInfo.phoneNumber,
                      },
                    });
                }

                // Signal the dispatch process to stop
                if (dispatchProcesses.has(rideId.toString())) {
                  const cancelFunction = dispatchProcesses.get(rideId.toString());
                  cancelFunction();
                }

                // Start sharing captain's location with customer
                rideSharingMap.set(captainId, ride.passenger);
              } else {
                // Ride was not found or already accepted
                socket.emit("rideError", "Ride not found or already accepted.");
              }
            } catch (err) {
              logger.error("Error accepting ride:", err);
              socket.emit("rideError", "Failed to accept ride. Please try again.");
            }
          });

          // Listen for captain canceling the ride
          socket.on("cancelRide", async (rideId) => {
            try {
              const ride = await Ride.findOne({ _id: rideId, driver: captainId });
              if (
                ride &&
                (ride.status === "accepted" || ride.status === "onRide")
              ) {
                // Update ride status back to 'requested'
                ride.status = "requested";
                ride.driver = null;
                await ride.save();

                // Remove from rideSharingMap
                rideSharingMap.delete(captainId);

                // Notify the customer
                if (onlineCustomers[ride.passenger]) {
                  customerNamespace
                    .to(onlineCustomers[ride.passenger])
                    .emit("rideCanceled", {
                      rideId: ride._id,
                      message:
                        "The captain has canceled the ride. Searching for another captain...",
                    });
                }

                // Restart the dispatch process
                dispatchRide(ride, {
                  latitude: ride.pickupLocation.coordinates[1],
                  longitude: ride.pickupLocation.coordinates[0],
                });
              } else {
                socket.emit("rideError", "Cannot cancel ride at this stage.");
              }
            } catch (err) {
              logger.error("Error canceling ride:", err);
              socket.emit("rideError", "Failed to cancel ride. Please try again.");
            }
          });

          // Listen for captain marking as 'arrived' at pickup location
          socket.on("arrived", async (rideId) => {
            try {
              const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "accepted" },
                { $set: { status: "arrived" } },
                { new: true }
              );

              if (ride) {
                // Notify the customer
                if (onlineCustomers[ride.passenger]) {
                  customerNamespace
                    .to(onlineCustomers[ride.passenger])
                    .emit("driverArrived", {
                      rideId: ride._id,
                      message: "Your captain has arrived.",
                    });
                }
                socket.emit("rideStatusUpdate", {
                  rideId: ride._id,
                  status: "arrived",
                });
              } else {
                socket.emit("rideError", "Cannot mark as arrived at this stage.");
              }
            } catch (err) {
              logger.error("Error marking ride as arrived:", err);
              socket.emit("rideError", "Failed to mark as arrived. Please try again.");
            }
          });

          // Listen for captain starting the ride
          socket.on("startRide", async (rideId) => {
            try {
              const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "arrived" },
                { $set: { status: "onRide" } },
                { new: true }
              );

              if (ride) {
                // Notify the customer
                if (onlineCustomers[ride.passenger]) {
                  customerNamespace
                    .to(onlineCustomers[ride.passenger])
                    .emit("rideStarted", {
                      rideId: ride._id,
                    });
                }
                socket.emit("rideStarted", {
                  rideId: ride._id,
                });
              } else {
                socket.emit("rideError", "Cannot start ride at this stage.");
              }
            } catch (err) {
              logger.error("Error starting ride:", err);
              socket.emit("rideError", "Failed to start ride. Please try again.");
            }
          });

          // Listen for captain ending the ride
          socket.on("endRide", async (rideId) => {
            try {
              const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "onRide" },
                { $set: { status: "completed" } },
                { new: true }
              );

              if (ride) {
                // Notify the customer
                if (onlineCustomers[ride.passenger]) {
                  customerNamespace
                    .to(onlineCustomers[ride.passenger])
                    .emit("rideCompleted", {
                      rideId: ride._id,
                      message:
                        "Your ride has been completed. Thank you for riding with us.",
                    });
                }
                socket.emit("rideStatusUpdate", {
                  rideId: ride._id,
                  status: "completed",
                });

                // Remove from rideSharingMap
                rideSharingMap.delete(captainId);

                // Optionally, remove captain's location from Redis if needed
                await redisClient.sendCommand(["ZREM", "captains", captainId]);
              } else {
                socket.emit("rideError", "Cannot end ride at this stage.");
              }
            } catch (err) {
              logger.error("Error ending ride:", err);
              socket.emit("rideError", "Failed to end ride. Please try again.");
            }
          });

          socket.on("disconnect", () => {
            logger.info("A captain disconnected");
            for (let id in onlineCaptains) {
              if (onlineCaptains[id] === socket.id) {
                delete onlineCaptains[id];
                logger.info(`Captain ${id} disconnected`);
                break;
              }
            }
          });
        }
      });
    });

    // Function to handle ride dispatching
    async function dispatchRide(ride, origin) {
      let radius = 2; // Starting radius in km
      const maxRadius = 10; // Maximum search radius
      const radiusIncrement = 0.5; // Radius increment in km
      const rideId = ride._id.toString();
      let cancelDispatch = false;

      // Store a cancellation function
      dispatchProcesses.set(rideId, () => {
        cancelDispatch = true;
      });

      const dispatchStartTime = Date.now(); // Record the dispatch start time
      const maxDispatchTime = 10 * 60 * 1000; // 10 minutes in milliseconds

      try {
        while (!cancelDispatch && radius <= maxRadius) {
          // Check if the max dispatch time has been exceeded
          if (Date.now() - dispatchStartTime >= maxDispatchTime) {
            logger.warn(`No captains accepted ride ${rideId} after 10 minutes`);
            // Update the ride status to 'notApprove'
            ride.status = "notApprove";
            ride.isDispatching = false;
            await ride.save();

            // Notify the customer if they are online
            if (onlineCustomers[ride.passenger]) {
              customerNamespace
                .to(onlineCustomers[ride.passenger])
                .emit("rideNotApproved", {
                  rideId: ride._id,
                  message: "No captains accepted your ride within 10 minutes.",
                });
            }

            // Exit the dispatch process
            cancelDispatch = true;
            break;
          }

          const nearbyCaptains = await findNearbyCaptains(origin, radius);

          if (nearbyCaptains.length > 0) {
            for (let captainId of nearbyCaptains) {
              if (cancelDispatch) break;

              if (onlineCaptains[captainId]) {
                const captainSocketId = onlineCaptains[captainId];

                // Send the ride request to the captain
                captainNamespace
                  .to(captainSocketId)
                  .emit("newRide", {
                    rideId: ride._id,
                    pickupLocation: ride.pickupLocation.coordinates,
                    dropoffLocation: ride.dropoffLocation.coordinates,
                    fare: ride.fare.amount,
                    distance: ride.distance,
                    duration: ride.duration,
                  });

                logger.info(`Sent ride ${rideId} to captain ${captainId}`);

                // Wait for 10 seconds
                await new Promise((resolve) => setTimeout(resolve, 10000));

                // Check if the ride has been accepted
                const updatedRide = await Ride.findById(rideId);

                if (updatedRide.status === "accepted") {
                  // Ride was accepted; stop dispatching
                  cancelDispatch = true;
                  logger.info(`Ride ${rideId} accepted by captain ${captainId}`);
                  break;
                } else {
                  logger.info(
                    `Captain ${captainId} did not accept ride ${rideId}`
                  );
                }
              }
            }
          } else {
            logger.info(`No captains found within radius: ${radius} km`);
          }

          if (!cancelDispatch) {
            // Increase the radius
            radius += radiusIncrement;
            logger.info(`Increasing search radius to: ${radius} km`);
          }
        }

        if (!cancelDispatch && radius > maxRadius) {
          // Max radius reached and still no captain accepted
          logger.warn(
            `No captains accepted ride ${rideId} after reaching max radius`
          );
          // Update the ride status to 'notApprove'
          ride.status = "notApprove";
          ride.isDispatching = false;
          await ride.save();

          // Notify the customer if they are online
          if (onlineCustomers[ride.passenger]) {
            customerNamespace
              .to(onlineCustomers[ride.passenger])
              .emit("rideNotApproved", {
                rideId: ride._id,
                message: "No captains accepted your ride within the maximum search radius.",
              });
          }
        }
      } catch (err) {
        logger.error("Error in dispatchRide:", err);
      } finally {
        // Clean up
        dispatchProcesses.delete(rideId);
      }
    }

    // CORS Configuration
    const corsOptions = {
      origin: [
        /^(http:\/\/.+:8080)$/,
        /^(http:\/\/.+:8085)$/,
        /^(http:\/\/.+:80)$/,
        /^(http:\/\/.+:3001)$/,
        /^(http:\/\/.+:3000)$/,
        /^(http:\/\/.+:5000)$/,
        /^(http:\/\/.+:5001)$/,
      ],
      credentials: true,
      "Access-Control-Allow-Credentials": true,
    };

    app.use(cors(corsOptions));

    // Serve static files
    app.use(express.static(path.join(__dirname, "public")));

    // Middleware Setup
    app.use(morgan("combined", { stream: { write: msg => logger.info(msg.trim()) } }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(flash());
    app.use(session({
      secret: process.env.SESSION_SECRET || "your-session-secret",
      resave: false,
      saveUninitialized: false,
    }));
    app.use(compression());

    // Set Views
    app.set("views", path.join(__dirname, "views"));
    app.set("view engine", "ejs");

    // Routes
    app.use(require("./routes"));

    // REST API endpoint for ride requests
    const apiRouter = express.Router();

    apiRouter.post('/api/requestRide', async (req, res) => {
      try {
        const rideData = req.body;
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        // Verify JWT token
        jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
          if (err) {
            logger.warn("JWT verification failed for customer");
            return res.status(401).json({ error: 'Unauthorized' });
          } else {
            const customerId = decoded.id;

            if (
              typeof rideData.origin.latitude === "number" &&
              typeof rideData.origin.longitude === "number" &&
              typeof rideData.destination.latitude === "number" &&
              typeof rideData.destination.longitude === "number"
            ) {
              // Create a new ride instance
              const newRide = new Ride({
                passenger: customerId,
                driver: null,
                pickupLocation: {
                  coordinates: [
                    rideData.origin.longitude,
                    rideData.origin.latitude,
                  ],
                },
                dropoffLocation: {
                  coordinates: [
                    rideData.destination.longitude,
                    rideData.destination.latitude,
                  ],
                },
                fare: {
                  amount: rideData.fareAmount || 6000,
                  currency: "IQD",
                },
                distance: rideData.distance,
                duration: rideData.duration,
                status: "requested",
              });

              // Save the new ride to MongoDB
              await newRide.save();
              logger.info(`Ride created for customer ${customerId}`);

              // Start the dispatch process
              // Mark ride as dispatching
              newRide.isDispatching = true;
              await newRide.save();

              dispatchRide(newRide, rideData.origin);

              res.status(201).json({ message: 'Ride requested successfully', rideId: newRide._id });
            } else {
              res.status(400).json({ error: 'Invalid location data' });
            }
          }
        });
      } catch (err) {
        logger.error("Error creating ride:", err);
        res.status(500).json({ error: 'Failed to create ride' });
      }
    });

    app.use('/', apiRouter);

    // Function to send current time to all connected clients (Optional)
    const sendTime = () => {
      io.emit("time", { time: new Date().toLocaleTimeString() });
    };

    // Ride dispatcher to monitor new rides
    setInterval(async () => {
      try {
        const newRides = await Ride.find({ status: 'requested', isDispatching: { $ne: true } });

        for (const ride of newRides) {
          // Mark the ride as being dispatched to prevent duplicate dispatching
          ride.isDispatching = true;
          await ride.save();

          // Start the dispatch process
          dispatchRide(ride, {
            latitude: ride.pickupLocation.coordinates[1],
            longitude: ride.pickupLocation.coordinates[0],
          });
        }
      } catch (err) {
        logger.error("Error in ride dispatcher:", err);
      }
    }, 5000); // Check every 5 seconds

    // Start the server
    const PORT = process.env.PORT || 5001;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });

})
.catch(err => {
    logger.error('Database connection error:', err);
    process.exit(1); // Exit the process with failure
});
