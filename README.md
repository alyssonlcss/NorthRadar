# Instalar dependências Python — instruções (PT-BR)

Coloque o arquivo de dependências (um `.txt` com uma lista de pacotes, ou um `requirements.txt`) na raiz do projeto.

Passos rápidos:

- (opcional) Normalizar um arquivo genérico `deps.txt` para `requirements.txt`:

```
python scripts/normalize_requirements.py deps.txt
```

- No Windows (PowerShell):

```
.\scripts\install_deps.ps1 [arquivo]
# exemplo: .\scripts\install_deps.ps1 deps.txt
```

- No Linux / macOS (bash):

```
bash scripts/install_deps.sh [arquivo]
# exemplo: bash scripts/install_deps.sh deps.txt
```

O script cria um ambiente virtual em `.venv` (se ainda não existir) e instala os pacotes via `pip -r`.

Observações:
- Se não informar o `arquivo`, o padrão é `requirements.txt`.
- Os scripts assumem que o `python` (ou `python3`) esteja disponível no PATH.
