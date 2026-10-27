import os
import runpy
import sys

file = os.path.abspath(sys.argv[1])
sys.argv = [file]
sys.path.insert(0, os.path.dirname(file))
runpy.run_path(file, run_name='__main__')
