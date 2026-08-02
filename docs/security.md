# Segurança

- Negação por padrão e menor privilégio.
- RLS obrigatória nas tabelas multi-tenant, sujeita a revisão e aprovação.
- Tenant não pode ser autorizado apenas por parâmetro enviado pelo navegador.
- Segredos e credenciais nunca entram no repositório.
- Logs não devem conter chaves Pix sensíveis, tokens ou payloads completos desnecessários.
- Webhooks exigirão verificação de autenticidade e idempotência.
- Alterações de RLS, pagamentos, credenciais e produção exigem aprovação de Caraffa.
- Testes de isolamento são gate de entrega, não opcionais.
