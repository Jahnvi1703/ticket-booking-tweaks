import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
    windowMs: 15*60*1000, 
    max:10000,
    message:{
        success:false,
        message:"Too many requests, please try again after 15 minutes"
    },
    standardHeaders:true,
    legacyHeaders:false
});