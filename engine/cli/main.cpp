#include <exception>
#include <iostream>

#include "jerrymap/sim.hpp"

int main(int argc, char** argv) {
    try {
        return jerrymap::run_cli(argc, argv);
    } catch (const std::exception& e) {
        std::cerr << "jerrymap: " << e.what() << "\n";
        return 1;
    }
}
