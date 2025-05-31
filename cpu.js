/**
 * cpu.js
 * Contains the logic for the AI opponent.
 * VERSION 7: Fixed Minimax opponent shift simulation.
 */
const cpu = {
  difficulty: 'medium',
  isThinking: false,
  watchdogTimer: null,

  // --- Public API ---
  init(difficulty) {
    this.difficulty = difficulty;
    this.isThinking = false;
  },

  makeMove() {
    if (this.isThinking || getIsGameOver()) return;

    console.log("%c[CPU] Thinking process started...", "color: blue; font-weight: bold;");
    this.isThinking = true;
    setUiControlsDisabled(true, true);
    updateStatus();

    this.watchdogTimer = setTimeout(() => {
      console.error("--- CPU STUCK ---");
      console.error("CPU has been thinking for over 10 seconds and has not made a move. The AI logic is likely stuck in an infinite loop or has crashed.");
    }, 10000);

    setTimeout(() => {
      const bestMove = this.findBestMove();
      console.log("[CPU] Thinking finished. Chosen move:", bestMove);

      clearTimeout(this.watchdogTimer);

      if (bestMove && bestMove.type) {
        console.log("[CPU] Executing move.");
        if (bestMove.type === 'place') {
          performCPUMove_place(bestMove.x, bestMove.y, bestMove.z);
        } else if (bestMove.type === 'rotate') {
          performCPUMove_rotate(bestMove.axis, bestMove.angle);
        }
      } else {
        console.error("CPU Error: findBestMove did not return a valid move. Forcing a fallback.");
        const placements = this.getAllPossiblePlacements(getBoardState());
        if (placements.length > 0) {
          console.log("[CPU] Executing fallback move.");
          performCPUMove_place(placements[0].x, placements[0].y, placements[0].z);
        } else {
          console.error("CPU Error: No possible moves found at all. The game should have ended.");
        }
      }
      this.isThinking = false;
    }, 800);
  },

  // --- Core Logic ---

  findBestMove() {
    const board = getBoardState();
    const winLength = getWinLength();
    const currentCPUCanShift = canPlayerShift(2) && getGameModeName() !== "No-Shift"; // For CPU's own moves

    const pieceCount = board.flat(2).filter(p => p !== 0).length;
    if (pieceCount < 2 && this.difficulty !== 'easy') {
      return this.makeFirstMove(board);
    }

    if (this.difficulty === 'easy') {
      const placements = this.getAllPossiblePlacements(board);
      let allMoves = [...placements];
      if (currentCPUCanShift) { // CPU's ability to shift for easy mode
        allMoves.push(...this.getAllPossibleRotations());
      }
      if (allMoves.length === 0) return null;
      return allMoves[Math.floor(Math.random() * allMoves.length)];
    }

    const allPossibleMoves = [
      ...this.getAllPossiblePlacements(board),
      ...(currentCPUCanShift ? this.getAllPossibleRotations() : []) // CPU's ability to shift
    ];

    if (allPossibleMoves.length === 0) return null;

    let bestMove = null;
    let bestScore = -Infinity;

    for (const move of allPossibleMoves) {
      const tempBoard = this.getBoardAfterMove(board, move, 2); // CPU's move (player 2)
      let score;

      if (this.difficulty === 'hard') {
        // Hard: 2-ply lookahead. Find opponent's best response.
        // Simulating opponent's turn (player 1), so isMaximizingPlayer = false
        score = this.minimax(tempBoard, 1, false, winLength, 1); // Depth 1, opponent's turn (player 1)
      } else {
        // Medium: 1-ply lookahead. Just score the board after CPU's move.
        score = this.scoreBoard(tempBoard, 2, winLength); // Score from CPU's perspective (player 2)
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove || allPossibleMoves[0];
  },

  /**
   * Minimax function to find the optimal score with lookahead.
   * @param {Array} board - The current board state.
   * @param {number} depth - How many moves to look ahead.
   * @param {boolean} isMaximizingPlayer - True for CPU (player 2), false for opponent (player 1).
   * @param {number} winLength - The win condition.
   * @param {number} currentPlayerForSim - The player whose turn is being simulated (1 or 2).
   * @returns {number} The best score found.
   */
  minimax(board, depth, isMaximizingPlayer, winLength, currentPlayerForSim) {
    // Static evaluation from the perspective of the CPU (player 2)
    const staticScore = this.scoreBoard(board, 2, winLength);
    if (depth === 0 || staticScore === Infinity || staticScore === -Infinity) {
      return staticScore;
    }

    // ★ MODIFIED: Use canPlayerShift with the correct player for simulation
    const simPlayerCanShift = canPlayerShift(currentPlayerForSim) && getGameModeName() !== "No-Shift";
    const possibleMoves = [
      ...this.getAllPossiblePlacements(board),
      ...(simPlayerCanShift ? this.getAllPossibleRotations() : [])
    ];

    if (possibleMoves.length === 0) { // No moves possible, could be a draw if not a win/loss
      return staticScore; // Return static score of current board
    }

    if (isMaximizingPlayer) { // CPU's turn to make a move in simulation
      let maxEval = -Infinity;
      for (const move of possibleMoves) {
        const newBoard = this.getBoardAfterMove(board, move, 2); // CPU (player 2) makes a move
        // Next turn is opponent's (player 1), so isMaximizingPlayer = false
        const an_eval = this.minimax(newBoard, depth - 1, false, winLength, 1);
        maxEval = Math.max(maxEval, an_eval);
      }
      return maxEval;
    } else { // Opponent's turn to make a move in simulation
      let minEval = Infinity;
      for (const move of possibleMoves) {
        const newBoard = this.getBoardAfterMove(board, move, 1); // Opponent (player 1) makes a move
        // Next turn is CPU's (player 2), so isMaximizingPlayer = true
        const an_eval = this.minimax(newBoard, depth - 1, true, winLength, 2);
        minEval = Math.min(minEval, an_eval);
      }
      return minEval;
    }
  },

  scoreBoard(board, player, winLength) {
    const opponent = 3 - player;
    let score = 0;

    if (this.checkForWin(board, player, winLength)) return Infinity;
    if (this.checkForWin(board, opponent, winLength)) return -Infinity;

    const myThreats = this.countThreats(board, player, winLength);
    const opponentThreats = this.countThreats(board, opponent, winLength);

    score += myThreats.major * 100;
    score += myThreats.minor * 10;
    score -= opponentThreats.major * 90;
    score -= opponentThreats.minor * 5;

    score += this.getCenterControlScore(board, player);
    return score;
  },

  countThreats(board, player, winLength) {
    let majorThreats = 0;
    let minorThreats = 0;
    const gridSize = board.length;
    const directions = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]];

    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        for (let x = 0; x < gridSize; x++) {
          for (const dir of directions) {
            const prevPos = { x: x - dir[0], y: y - dir[1], z: z - dir[2] };
            if (this.isInBounds(prevPos, gridSize) && board[prevPos.y][prevPos.z][prevPos.x] === player) {
              continue;
            }

            let playerCount = 0;
            let emptyCount = 0;
            let lineIsBlocked = false;
            for (let i = 0; i < winLength; i++) {
              const currPos = { x: x + dir[0] * i, y: y + dir[1] * i, z: z + dir[2] * i };
              if (!this.isInBounds(currPos, gridSize)) {
                lineIsBlocked = true;
                break;
              }
              const piece = board[currPos.y][currPos.z][currPos.x];
              if (piece === player) playerCount++;
              else if (piece === 0) emptyCount++;
              else {
                lineIsBlocked = true;
                break;
              }
            }

            if (!lineIsBlocked && emptyCount > 0) { // Threat must have empty spaces to be completed
              if (playerCount === winLength - 1) majorThreats++;
              if (playerCount === winLength - 2 && emptyCount >= 2) minorThreats++; // Need enough space for minor threat
            }
          }
        }
      }
    }
    return { major: majorThreats, minor: minorThreats };
  },

  makeFirstMove(board) {
    const placements = this.getAllPossiblePlacements(board);
    if (placements.length === 0) return null; // Should not happen on an early move
    const center = (board.length - 1) / 2;
    let bestPlacement = placements[0];
    let minDistance = Infinity;

    for (const p of placements) {
      const dist = Math.sqrt(Math.pow(p.x - center, 2) + Math.pow(p.y - center, 2) + Math.pow(p.z - center, 2));
      if (dist < minDistance) {
        minDistance = dist;
        bestPlacement = p;
      }
    }
    return bestPlacement;
  },

  getCenterControlScore(board, player) {
    let score = 0;
    const center = (board.length - 1) / 2;
    const maxDist = Math.sqrt(3 * Math.pow(center, 2));

    for (let y = 0; y < board.length; y++) {
      for (let z = 0; z < board.length; z++) {
        for (let x = 0; x < board.length; x++) {
          if (board[y][z][x] === player) {
            const dist = Math.sqrt(Math.pow(x - center, 2) + Math.pow(y - center, 2) + Math.pow(z - center, 2));
            score += (maxDist - dist) * 0.01;
          }
        }
      }
    }
    return score;
  },

  isInBounds(pos, gridSize) {
    return pos.x >= 0 && pos.y >= 0 && pos.z >= 0 && pos.x < gridSize && pos.y < gridSize && pos.z < gridSize;
  },

  getBoardAfterMove(board, move, player) {
    if (move.type === 'place') {
      return this.getBoardAfterPlacement(board, move.x, move.y, move.z, player);
    } else {
      return this.getBoardAfterRotation(board, move.axis, move.angle);
    }
  },

  getAllPossiblePlacements(board) {
    const placements = [];
    const gravity = getGravityVector(); // From game.js
    const { axis: gravityAxis, dir: gravityDir } = getGravityAxisAndDirFromVec(gravity); // From game.js
    const gridSize = board.length;

    for (let u = 0; u < gridSize; u++) {
      for (let v = 0; v < gridSize; v++) {
        for (let w_scan = 0; w_scan < gridSize; w_scan++) {
          const w = (gravityDir === -1) ? w_scan : gridSize - 1 - w_scan;
          const pos = {};
          if (gravityAxis === 'y') { pos.x = u; pos.y = w; pos.z = v; }
          else if (gravityAxis === 'x') { pos.x = w; pos.y = u; pos.z = v; }
          else { pos.x = u; pos.y = v; pos.z = w; }
          if (this.isInBounds(pos, gridSize) && board[pos.y][pos.z][pos.x] === 0) {
            placements.push({ type: 'place', x: pos.x, y: pos.y, z: pos.z });
            break;
          }
        }
      }
    }
    return placements;
  },

  getAllPossibleRotations: () => [
    { id: 'btnRollLeft', type: 'rotate', axis: new THREE.Vector3(0, 0, 1), angle: Math.PI / 2 },
    { id: 'btnRollRight', type: 'rotate', axis: new THREE.Vector3(0, 0, 1), angle: -Math.PI / 2 },
    { id: 'btnTiltFwd', type: 'rotate', axis: new THREE.Vector3(1, 0, 0), angle: -Math.PI / 2 },
    { id: 'btnTiltBack', type: 'rotate', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI / 2 },
    { id: 'btnFlip', type: 'rotate', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI }
  ],

  getBoardAfterPlacement(board, x, y, z, player) {
    const newBoard = JSON.parse(JSON.stringify(board));
    if (this.isInBounds({ x, y, z }, board.length) && newBoard[y][z][x] === 0) { // Check bounds and empty
      newBoard[y][z][x] = player;
    }
    return newBoard;
  },

  getBoardAfterRotation(board, rotationAxis, angle) {
    const currentQuaternion = getGameGroupQuaternion(); // From game.js
    const mainRotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
    const targetGroupQuaternion = currentQuaternion.clone().multiply(mainRotationQuaternion);
    const worldDown = new THREE.Vector3(0, -1, 0);
    let newLocalGravity = worldDown.clone().applyQuaternion(targetGroupQuaternion.clone().invert());
    let absX = Math.abs(newLocalGravity.x), absY = Math.abs(newLocalGravity.y), absZ = Math.abs(newLocalGravity.z);
    let maxVal = Math.max(absX, absY, absZ);
    if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0);
    else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0);
    else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z));
    return applyGravityToBoard(board, newLocalGravity); // From game.js
  },

  checkForWin(board, player, winLength) {
    const gridSize = board.length;
    const directions = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]];
    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        for (let x = 0; x < gridSize; x++) {
          if (board[y][z][x] !== player) continue;
          for (const dir of directions) {
            let count = 0;
            for (let i = 0; i < winLength; i++) {
              const currPos = { x: x + dir[0] * i, y: y + dir[1] * i, z: z + dir[2] * i };
              if (this.isInBounds(currPos, gridSize) && board[currPos.y][currPos.z][currPos.x] === player) {
                count++;
              } else {
                break;
              }
            }
            if (count === winLength) return true;
          }
        }
      }
    }
    return false;
  }
};