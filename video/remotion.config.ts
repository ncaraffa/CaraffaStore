import { Config } from "@remotion/cli/config";

/**
 * Vídeo de marketing: qualidade acima de tempo de render. O projeto é
 * pequeno e roda em minutos mesmo com escala 1.
 */
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
