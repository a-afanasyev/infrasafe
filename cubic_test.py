import sys
from PyQt5.QtWidgets import (QWidget, QTabWidget, QPushButton, QHBoxLayout,
                             QTextEdit, QLabel, QVBoxLayout, QApplication)
from PyQt5.QtCore import QTimer, Qt, QObject
from PyQt5.QtGui import QPainter, QColor, QPen
import cv2
import numpy as np

class RubiksCubeAssembler(QObject):
    def __init__(self):
        super().__init__()
        self.cube = None
        self.moves_stack = []
        self.current_move = []
        self.view_mode = 'front'  # 'front' or 'top'
        self.colors = {
            'U': QColor(255, 255, 255),  # White
            'D': QColor(255, 255, 0),    # Yellow
            'F': QColor(0, 255, 0),      # Green
            'B': QColor(0, 0, 255),      # Blue
            'R': QColor(255, 0, 0),      # Red
            'L': QColor(255, 165, 0)     # Orange
        }
        # Определяем соседние грани для каждой грани
        self.adjacent_faces = {
            'U': {'clockwise': [('F', 0, None), ('R', 0, None), ('B', 0, None), ('L', 0, None)],
                 'counterclockwise': [('F', 0, None), ('L', 0, None), ('B', 0, None), ('R', 0, None)]},
            'D': {'clockwise': [('F', 2, None), ('L', 2, None), ('B', 2, None), ('R', 2, None)],
                 'counterclockwise': [('F', 2, None), ('R', 2, None), ('B', 2, None), ('L', 2, None)]},
            'F': {'clockwise': [('U', 2, None), ('R', None, 0), ('D', 0, True), ('L', None, 2)],
                 'counterclockwise': [('U', 2, None), ('L', None, 2), ('D', 0, True), ('R', None, 0)]},
            'B': {'clockwise': [('U', 0, True), ('L', None, 0), ('D', 2, None), ('R', None, 2)],
                 'counterclockwise': [('U', 0, True), ('R', None, 2), ('D', 2, None), ('L', None, 0)]},
            'R': {'clockwise': [('U', None, 2), ('B', None, 0), ('D', None, 2), ('F', None, 2)],
                 'counterclockwise': [('U', None, 2), ('F', None, 2), ('D', None, 2), ('B', None, 0)]},
            'L': {'clockwise': [('U', None, 0), ('F', None, 0), ('D', None, 0), ('B', None, 2)],
                 'counterclockwise': [('U', None, 0), ('B', None, 2), ('D', None, 0), ('F', None, 0)]}
        }

    def initialize_cube(self):
        # Создаем простую структуру кубика с цветами
        self.cube = {
            'U': {'clockwise': np.full((3, 3), 'U'), 'counterclockwise': np.full((3, 3), 'U')},
            'D': {'clockwise': np.full((3, 3), 'D'), 'counterclockwise': np.full((3, 3), 'D')},
            'F': {'clockwise': np.full((3, 3), 'F'), 'counterclockwise': np.full((3, 3), 'F')},
            'B': {'clockwise': np.full((3, 3), 'B'), 'counterclockwise': np.full((3, 3), 'B')},
            'R': {'clockwise': np.full((3, 3), 'R'), 'counterclockwise': np.full((3, 3), 'R')},
            'L': {'clockwise': np.full((3, 3), 'L'), 'counterclockwise': np.full((3, 3), 'L')}
        }
        return self.cube

    def add_move(self, move):
        if not isinstance(move, str):
            print("Invalid move format. Use uppercase letters (U, D, F, B, R, L) and include direction.")
            return False
        # Проверяем формат команды
        parts = move.strip().split()
        if len(parts) != 2 or parts[0] not in ['U', 'D', 'F', 'B', 'R', 'L'] or parts[1] not in ['clockwise', 'counterclockwise']:
            print(f"Invalid move format: {move}")
            return False
        self.current_move.append(parts)
        return True

    def apply_move(self):
        for move in self.current_move:
            face, direction = move
            if face not in ['U', 'D', 'F', 'B', 'R', 'L']:
                print(f"Invalid move: {face}")
                return False
            rotation = self._apply_single_move(face, direction)
            if not rotation:
                return False
        self.current_move = []  # Очищаем список команд после применения
        return True

    def _apply_single_move(self, face, direction):
        if face not in self.cube:
            return False

        # Сохраняем копию текущего состояния граней
        old_state = {
            f: self.cube[f]['clockwise'].copy() for f in self.cube
        }

        # Поворачиваем основную грань
        face_data = self.cube[face]['clockwise']
        k = -1 if direction == 'clockwise' else 1
        self.cube[face]['clockwise'] = np.rot90(face_data, k=k)
        self.cube[face]['counterclockwise'] = self.cube[face]['clockwise']

        # Обновляем соседние грани
        adjacent = self.adjacent_faces[face][direction]
        prev_values = None

        # Получаем значения со всех граней перед изменением
        values = []
        for adj_face, row, flip in adjacent:
            current_face = self.cube[adj_face]['clockwise']
            if row is not None:
                val = current_face[row].copy()
            else:
                val = current_face[:, row].copy()
            if flip:
                val = np.flip(val)
            values.append(val)

        # Сдвигаем значения
        values = values[-1:] + values[:-1]

        # Применяем новые значения
        for i, (adj_face, row, flip) in enumerate(adjacent):
            val = values[i]
            if flip:
                val = np.flip(val)
            
            current_face = self.cube[adj_face]['clockwise']
            if row is not None:
                current_face[row] = val
            else:
                current_face[:, row] = val
            
            self.cube[adj_face]['clockwise'] = current_face
            self.cube[adj_face]['counterclockwise'] = current_face

        return True

    def render_view(self):
        if self.view_mode == 'front':
            pass  # No change needed; this is handled by OpenCV's default behavior
        elif self.view_mode == 'top':
            pass
        else:
            print("Invalid view mode")
            return False

    def switch_views(self):
        self.view_mode = 'front' if self.view_mode == 'top' else 'top'
        self.render_view()

class CubePreviewWidget(QWidget):
    def __init__(self, cube_assembler):
        super().__init__()
        self.cube_assembler = cube_assembler
        self.cube_assembler._preview_widget = self  # Сохраняем ссылку на виджет
        self.cell_size = 40
        self.margin = 10
        self.setMinimumSize(600, 600)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Заполняем фон
        painter.fillRect(self.rect(), Qt.white)

        # Рисуем развертку кубика
        if self.cube_assembler.view_mode == 'front':
            self.draw_front_view(painter)
        else:
            self.draw_top_view(painter)

    def draw_front_view(self, painter):
        # Позиции граней в развертке (x, y) относительно верхней грани
        positions = {
            'U': (3, 0),  # Верхняя грань
            'L': (0, 3),  # Левая грань
            'F': (3, 3),  # Передняя грань
            'R': (6, 3),  # Правая грань
            'B': (9, 3),  # Задняя грань
            'D': (3, 6)   # Нижняя грань
        }
        
        for face, (x_offset, y_offset) in positions.items():
            face_data = self.cube_assembler.cube[face]['clockwise']
            # Рисуем рамку вокруг грани
            x = x_offset * self.cell_size + self.margin
            y = y_offset * self.cell_size + self.margin
            painter.setPen(QPen(Qt.black, 2))
            painter.drawRect(x, y, self.cell_size * 3, self.cell_size * 3)
            
            # Рисуем ячейки
            for i in range(3):
                for j in range(3):
                    x = (x_offset + j) * self.cell_size + self.margin
                    y = (y_offset + i) * self.cell_size + self.margin
                    color = self.cube_assembler.colors[face_data[i][j]]
                    self.draw_cell(painter, x, y, color)

    def draw_top_view(self, painter):
        # Позиции граней при виде сверху
        positions = {
            'B': (3, 0),
            'L': (0, 3),
            'U': (3, 3),
            'R': (6, 3),
            'D': (3, 6),
            'F': (3, 9)
        }
        
        for face, (x_offset, y_offset) in positions.items():
            face_data = self.cube_assembler.cube[face]['clockwise']
            # Рисуем рамку вокруг грани
            x = x_offset * self.cell_size + self.margin
            y = y_offset * self.cell_size + self.margin
            painter.setPen(QPen(Qt.black, 2))
            painter.drawRect(x, y, self.cell_size * 3, self.cell_size * 3)
            
            # Рисуем ячейки
            for i in range(3):
                for j in range(3):
                    x = (x_offset + j) * self.cell_size + self.margin
                    y = (y_offset + i) * self.cell_size + self.margin
                    color = self.cube_assembler.colors[face_data[i][j]]
                    self.draw_cell(painter, x, y, color)

    def draw_cell(self, painter, x, y, color):
        painter.setPen(QPen(Qt.black, 1))
        painter.setBrush(color)
        painter.drawRect(x, y, self.cell_size, self.cell_size)

class QtWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Rubik's Cube Assembler")
        self.resize(1200, 800)
        
        # Initialize cube
        self.cube = RubiksCubeAssembler()
        self.cube.initialize_cube()
        
        # Initialize tabs
        self.tabs = QTabWidget()
        self.tab1 = QWidget()
        self.tab2 = CubePreviewWidget(self.cube)
        self.tabs.addTab(self.tab1, "Moves Stack")
        self.tabs.addTab(self.tab2, "Cube Preview")

        self.init_ui()

    def init_ui(self):
        layout = QHBoxLayout()
        layout.addWidget(self.tabs)
        
        # Instructions label
        instructions = QLabel("Instructions:\n"
                            "Use the controls below to input move sequences and watch the cube assemble.\n\n"
                            "To use the program:\n"
                            "1. Input moves in uppercase letters (U, D, F, B, R, L).\n"
                            "2. Each move is followed by 'clockwise' or 'counterclockwise'.\n"
                            "3. Separate multiple moves with commas.\n"
                            "4. The cube preview will show the effect of each move in sequence.")
        instructions.setAlignment(Qt.AlignBottom)
        layout.addWidget(instructions)
        
        # Controls
        self.controls = QWidget()
        controls_layout = QVBoxLayout()
        
        self.moves_input = QTextEdit()
        controls_layout.addWidget(QLabel("Moves:"))
        controls_layout.addWidget(self.moves_input)
        
        # Buttons
        load_btn = QPushButton("Load Configuration")
        save_btn = QPushButton("Save Configuration")
        apply_btn = QPushButton("Apply Moves")
        switch_view_btn = QPushButton("Switch View")
        clear_btn = QPushButton("Clear Canvas")
        exit_btn = QPushButton("Exit Program")
        
        controls_layout.addWidget(load_btn)
        controls_layout.addWidget(save_btn)
        controls_layout.addWidget(apply_btn)
        controls_layout.addWidget(switch_view_btn)
        controls_layout.addWidget(clear_btn)
        controls_layout.addWidget(exit_btn)
        
        # Connect buttons
        load_btn.clicked.connect(self.load_configuration)
        save_btn.clicked.connect(self.save_configuration)
        apply_btn.clicked.connect(self.apply_moves)
        switch_view_btn.clicked.connect(self.switch_view)
        clear_btn.clicked.connect(self.clear_canvas)
        exit_btn.clicked.connect(self.close)
        
        self.controls.setLayout(controls_layout)
        layout.addWidget(self.controls)
        
        self.setLayout(layout)
        
        self.updateDisplay()

    def load_configuration(self):
        print("Load configuration clicked")

    def save_configuration(self):
        print("Save configuration clicked")

    def apply_moves(self):
        moves = self.moves_input.toPlainText().strip()
        if moves:
            for move in moves.split(','):
                self.cube.add_move(move.strip())
            if self.cube.apply_move():
                print("Moves applied successfully")
            self.updateDisplay()

    def switch_view(self):
        self.cube.switch_views()
        self.updateDisplay()

    def clear_canvas(self):
        self.moves_input.clear()
        self.cube.current_move = []
        self.updateDisplay()

    def updateDisplay(self):
        self.tab2.update()  # Обновляем виджет предпросмотра
        self.tab2.repaint()  # Принудительно перерисовываем
        print("Display updated")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = QtWindow()
    window.show()
    sys.exit(app.exec_()) 