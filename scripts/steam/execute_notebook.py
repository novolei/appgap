"""Execute using this interpreter's dependencies; no global kernel registration."""
import json
import pathlib
import sys
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
from jupyter_client.kernelspec import KernelSpecManager

root = pathlib.Path(__file__).resolve().parents[2]
kernel_root = pathlib.Path(sys.prefix)/'share/jupyter/kernels'
kernel = kernel_root/'appgap-analysis'
kernel.mkdir(parents=True, exist_ok=True)
(kernel/'kernel.json').write_text(json.dumps({'argv':[sys.executable,'-m','ipykernel_launcher','-f','{connection_file}'],'display_name':'AppGap analysis','language':'python'}),encoding='utf-8')
path = root/'reports/steam-analysis-2026-10-25.ipynb'
notebook = nbformat.read(path,as_version=4)
NotebookClient(notebook,kernel_name='appgap-analysis',kernel_spec_manager=KernelSpecManager(kernel_dirs=[str(kernel_root)]),timeout=120,resources={'metadata':{'path':str(path.parent)}}).execute()
nbformat.validate(notebook)
nbformat.write(notebook,path)
html, _ = HTMLExporter(exclude_input=False).from_notebook_node(notebook)
path.with_suffix('.html').write_text(html,encoding='utf-8')
assert all(output.output_type!='error' for cell in notebook.cells if cell.cell_type=='code' for output in cell.outputs)
print('NOTEBOOK_EXECUTED_OK', len([cell for cell in notebook.cells if cell.cell_type=='code']), 'code cells')
