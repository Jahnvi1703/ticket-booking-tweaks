import jwt from "jsonwebtoken";

//Issue token with payloads claims
export const generateToken = (payload) =>{
    return jwt.sign(payload, process.env.JWT_SECRET,{
      expiresIn:process.env.expiresIn || "1d"
    });
};

//decode and verify token string
export const verifyToken =(token)=>{
return jwt.verify(token, process.env.JWT_SECRET);
}
