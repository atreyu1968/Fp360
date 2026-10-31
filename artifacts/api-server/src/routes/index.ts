import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import redfp360Router from "./redfp360";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(redfp360Router);

export default router;
