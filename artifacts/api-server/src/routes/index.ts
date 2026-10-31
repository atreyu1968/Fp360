import { Router, type IRouter } from "express";
import healthRouter from "./health";
import redfp360Router from "./redfp360";

const router: IRouter = Router();

router.use(healthRouter);
router.use(redfp360Router);

export default router;
