import express from "express";
import prisma from "../lib/prisma.js";
import { comparePassword, hashPassword } from "../utils/hash.js";
import { generateToken, verifyToken } from "../utils/jwt.js";

const router=express.Router();

router.post("/register", async(req, res)=>{
    try{
        const {name, email, password, role}= req.body;

        if(!name|| !email|| !password){
  return res.status(400).json({success:false, message:"missing fields!"})
        }

        const hashedPassword=await hashPassword(password);

       const newUser= await prisma.user.create({
        data:{name, email, password:hashedPassword, role}
       })
     
  // Extract password into '_' (throwaway variable) and gather the rest into 'userWithoutPassword'
  const{password:_, ...userWithoutPass}=newUser;

       return res.status(201).json({success:true, message:"new user created", data:userWithoutPass})

    }catch(err){

        if(err.code==="P2002"){
            return res.status(409).json({success:false, message:"A account with this email already exists"})
        }
  return res.status(500).json({success:false, error:err.message})
    }
})


router.post("/login", async(req, res)=>{
    try{
  const {email, password}= req.body;

  if(!email || ! password){
    return res.status(400).json({success:false, message:"missing fields!"})
  }

  const user= await prisma.user.findUnique({
    where:{email}
  })

  if(!user){
    return res.status(401).json({success:false, message:"Invalid user or password"})
  }

  const isMatch= await comparePassword(password, user.password)

  if(!isMatch){
    return res.status(401).json({success:false, message:"Invalid user or password"})
  }

  const payload={id:user.id, role:user.role, email:user.email};
  const signToken= await generateToken(payload)

  return res.status(200).json({success:true, token:signToken, message:'Token created successfully'})

    }catch(err){
 return res.status(500).json({success:false, error:err.message})
    }
})

export default router;