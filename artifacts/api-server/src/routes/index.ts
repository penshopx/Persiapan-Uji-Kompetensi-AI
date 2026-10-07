import { Router, type IRouter } from "express";
import healthRouter from "./health";
import competencyRouter from "./competency";

const router: IRouter = Router();

router.use(healthRouter);
router.use(competencyRouter);

export default router;
