from pathlib import Path
import hashlib
import sys
import tempfile
import unittest
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from image_pipeline import align_patch, crop_page, paste_patch


class ImagePipelineTests(unittest.TestCase):
    def test_requested_resize_and_paste_preserve_pixels_outside_box(self):
        with tempfile.TemporaryDirectory(prefix="comic-pixels-") as folder:
            root = Path(folder)
            base, patch = root / "base.png", root / "patch.png"
            Image.new("RGBA", (724, 2172), (80, 90, 100, 255)).save(base)
            Image.new("RGBA", (1024, 1344), (20, 170, 110, 255)).save(patch)
            original = hashlib.sha256(base.read_bytes()).hexdigest()
            self.assertEqual(crop_page(base, [412, 1680, 236, 310], root / "crop.png"), (236, 310))
            report = align_patch(patch, (236, 310), root / "aligned.png")
            self.assertLess(report["ratioDeviation"], 0.02)
            paste_patch(base, root / "aligned.png", [412, 1680, 236, 310], None, root / "repaired.png")
            with Image.open(root / "repaired.png") as output:
                self.assertEqual(output.size, (724, 2172))
                self.assertEqual(output.getpixel((500, 1800)), (20, 170, 110, 255))
                self.assertEqual(output.getpixel((411, 1680)), (80, 90, 100, 255))
                self.assertEqual(output.getpixel((648, 1990)), (80, 90, 100, 255))
            self.assertEqual(hashlib.sha256(base.read_bytes()).hexdigest(), original)

    def test_polygon_mask_preserves_pixels_outside_shape(self):
        with tempfile.TemporaryDirectory(prefix="comic-pixels-") as folder:
            root = Path(folder)
            Image.new("RGBA", (200, 200), (10, 20, 30, 255)).save(root / "base.png")
            Image.new("RGBA", (100, 100), (200, 210, 220, 255)).save(root / "patch.png")
            paste_patch(root / "base.png", root / "patch.png", [50, 50, 100, 100], [[50, 50], [150, 50], [50, 150]], root / "out.png")
            with Image.open(root / "out.png") as output:
                self.assertEqual(output.getpixel((70, 70)), (200, 210, 220, 255))
                self.assertEqual(output.getpixel((140, 140)), (10, 20, 30, 255))

    def test_aspect_mismatch_does_not_produce_stretched_patch(self):
        with tempfile.TemporaryDirectory(prefix="comic-pixels-") as folder:
            root = Path(folder)
            Image.new("RGBA", (500, 100)).save(root / "patch.png")
            with self.assertRaisesRegex(ValueError, "宽高比"):
                align_patch(root / "patch.png", (236, 310), root / "aligned.png")
            self.assertFalse((root / "aligned.png").exists())

    def test_original_border_is_not_painted_over(self):
        with tempfile.TemporaryDirectory(prefix="comic-pixels-") as folder:
            root = Path(folder)
            Image.new("RGBA", (200, 200), (10, 20, 30, 255)).save(root / "base.png")
            Image.new("RGBA", (100, 100), (200, 210, 220, 255)).save(root / "patch.png")
            paste_patch(root / "base.png", root / "patch.png", [50, 50, 100, 100], None, root / "out.png", border=2)
            with Image.open(root / "out.png") as output:
                self.assertEqual(output.getpixel((50, 50)), (10, 20, 30, 255))
                self.assertEqual(output.getpixel((80, 80)), (200, 210, 220, 255))


if __name__ == "__main__":
    unittest.main()
