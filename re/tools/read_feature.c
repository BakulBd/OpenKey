#include <errno.h>
#include <fcntl.h>
#include <linux/hidraw.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(int argc, char **argv)
{
    const char *path = argc > 1 ? argv[1] : "/dev/hidraw7";

    int fd = open(path, O_RDWR);
    if (fd < 0) {
        perror("open");
        return 1;
    }

    unsigned char buf[65] = {0};
    buf[0] = 0x00;

    int n = ioctl(fd, HIDIOCGFEATURE(sizeof(buf)), buf);

    if (n < 0) {
        fprintf(stderr, "HIDIOCGFEATURE failed: %s\n", strerror(errno));
        close(fd);
        return 1;
    }

    printf("Returned %d bytes\n", n);

    for (int i = 0; i < n; i++) {
        printf("%02X%s", buf[i], (i + 1) % 16 == 0 ? "\n" : " ");
    }

    if (n % 16)
        putchar('\n');

    close(fd);
    return 0;
}
