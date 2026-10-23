import bcrypt, { compare } from "bcryptjs";

const SALT_ROUNDS= 10;

//Encypt password plain text
export const hashPassword = async (plainPassword)=>{
    return  bcrypt.hash(plainPassword, SALT_ROUNDS);
};

//Verify plain text input password against hash
export const comparePassword = async(plainPassword, hashedPassword) =>{
    return  bcrypt.compare(plainPassword, hashedPassword);
};