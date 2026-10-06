import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import civicaiRouter from "./civicai";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(civicaiRouter);
router.use(storageRouter);

export default router;
