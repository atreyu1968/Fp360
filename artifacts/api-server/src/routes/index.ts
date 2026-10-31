import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import redfp360Router from "./redfp360";
import administrationRouter from "./administration";
import catalogRouter from "./catalog";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(administrationRouter);
router.use(catalogRouter);
router.use(redfp360Router);

export default router;
