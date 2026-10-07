import { Router, type IRouter } from "express";
import healthRouter from "./health";
import competencyRouter from "./competency";
import ujkRouter from "./ujk";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(competencyRouter);
router.use(ujkRouter);
router.use(storageRouter);

export default router;
