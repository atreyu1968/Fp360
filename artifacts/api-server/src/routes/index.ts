import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import redfp360Router from "./redfp360";
import administrationRouter from "./administration";
import catalogRouter from "./catalog";
import crmRouter from "./crm";
import purchasesRouter from "./purchases";
import purchaseFulfillmentRouter from "./purchases-fulfillment";
import directionRouter from "./direction";
import logisticsRouter from "./logistics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(administrationRouter);
router.use(catalogRouter);
router.use(crmRouter);
router.use(purchasesRouter);
router.use(purchaseFulfillmentRouter);
router.use(directionRouter);
router.use(logisticsRouter);
router.use(redfp360Router);

export default router;
