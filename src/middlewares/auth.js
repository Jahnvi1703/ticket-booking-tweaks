import { verifyToken } from "../utils/jwt.js";


//Authentication guard : Verifies bearer token
export const requireAuth = (req, res, next)=>{
try{
const authHeader= req.headers.authorization;

if(!authHeader || !authHeader.startsWith("Bearer ")){
return res.status(401).json({success:false, message:"Unauthorized! Missing, or malformed token header"})
}

const token= authHeader.split(" ")[1];
const decoded= verifyToken(token);

//attach user claims ({id, role}) to request context
req.user={
    id:decoded.id,
    role:decoded.role,
    email:decoded.email
};

next();
}catch(err){
return res.status(401).json({success:false, message:'Unauthorized! , token verification failed or expired'});
}
};


//Role based access control guard (RBAC)
export const restrictTo = (...allowedRoles)=>{
    
    return(req, res, next) => {
        if(!req.user){
            return res.status(500).json({success:false, message:"Internal configuration error : identity context missing"})
        }

        if(!allowedRoles.includes(req.user.role)){
            return res.status(403).json({success:false, message:`Forbidden your account role ${req.user.role} lacks sufficient clearance priviledges` })
        }

        next();
    }
};