import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

/**
 * As MESMAS três fontes do site, carregadas localmente pelo Remotion
 * (nenhuma requisição de rede durante o render, o que também torna o
 * resultado reproduzível offline).
 *
 * Os papéis não se misturam, igual ao produto: display em títulos e
 * preços, Inter em toda a interface, mono em dado literal — código de
 * pedido, chave Pix, rótulo de seção.
 */
loadDisplay();
loadSans();
loadMono();
