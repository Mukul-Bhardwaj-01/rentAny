// Single shared Prisma client so we don't open a new DB connection
// every time a controller needs one.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
