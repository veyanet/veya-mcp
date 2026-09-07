#!/usr/bin/env node
import { startHttpServer } from "./http.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
startHttpServer(cfg);
